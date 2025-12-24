/**
 * 数据库初始化
 * 支持 SQLite (better-sqlite3) 和 Turso
 * 优化：本地数据库优先，Turso 异步连接不阻塞
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const normalizeBoolean = (value) => {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const CREATE_FIELD_TEMPLATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS notebook_field_templates (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    fields TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(notebook_id, source_type)
  )
`;

const CREATE_FIELD_TEMPLATE_PREFERENCE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS field_template_preferences (
    source_type TEXT PRIMARY KEY,
    notebook_id TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_AI_FIELD_DEFINITIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ai_field_definitions (
    id TEXT PRIMARY KEY,
    notebook_id TEXT,
    field_key TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    data_type TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'analysis_v2_ai',
    prompt_template_id TEXT,
    model TEXT,
    model_version TEXT,
    extra_config TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(notebook_id, field_key)
  )
`;

const CREATE_AI_FIELD_VALUES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ai_field_values (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    field_def_id TEXT NOT NULL,
    value_number REAL,
    value_text TEXT,
    value_json TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    error_message TEXT,
    model TEXT,
    prompt_template_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(note_id, field_def_id)
  )
`;

const CREATE_AUTH_USERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT,
    email_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  )
`;

const CREATE_AUTH_OAUTH_ACCOUNTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS auth_oauth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_email TEXT,
    provider_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_user_id),
    FOREIGN KEY (user_id) REFERENCES auth_users(id)
  )
`;

const CREATE_AUTH_SESSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT,
    ip TEXT,
    user_agent TEXT,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES auth_users(id)
  )
`;

const CREATE_AUTH_TOKENS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL, -- email_verify | password_reset
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    meta TEXT,
    FOREIGN KEY (user_id) REFERENCES auth_users(id)
  )
`;

/**
 * 初始化数据库连接
 * @returns {Promise<object>} 数据库实例 { primary: 本地数据库, tursoClient: Turso客户端 }
 */
export async function initDB() {
  const shouldUseTurso = normalizeBoolean(process.env.USE_TURSO);
  
  // ========== 第一步：立即创建本地数据库（不阻塞） ==========
  const Database = (await import('better-sqlite3')).default;
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data.db');
  console.log('✅ 初始化本地 SQLite 数据库（主数据库）:', dbPath);
  const localDbInstance = new Database(dbPath);
  initializeTablesSync(localDbInstance);
  
  // 本地数据库接口（主数据库，所有查询都使用这个）
  const localDb = {
    get: async (sql, params = []) => {
      try {
        const stmt = localDbInstance.prepare(sql);
        return stmt.get(...params) || null;
      } catch (error) {
        console.error('❌ 数据库查询失败:', error);
        throw error;
      }
    },
    all: async (sql, params = []) => {
      try {
        const stmt = localDbInstance.prepare(sql);
        return stmt.all(...params) || [];
      } catch (error) {
        console.error('❌ 数据库查询失败:', error);
        throw error;
      }
    },
    run: async (sql, params = []) => {
      try {
        const stmt = localDbInstance.prepare(sql);
        const result = stmt.run(...params);
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      } catch (error) {
        console.error('❌ 数据库执行失败:', error);
        throw error;
      }
    },
    execute: async (sql, params = []) => {
      try {
        const stmt = localDbInstance.prepare(sql);
        return stmt.run(...params);
      } catch (error) {
        console.error('❌ 数据库执行失败:', error);
        throw error;
      }
    }
  };
  
  // ========== 第二步：异步连接 Turso（不阻塞服务器启动） ==========
  let tursoDb = null;
  let tursoConnectionPromise = null;
  
  if (shouldUseTurso && process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    // 创建连接 Promise（异步执行，不阻塞）
    tursoConnectionPromise = (async () => {
      try {
        console.log('🔌 异步连接 Turso 数据库（不阻塞启动）...');
        const { createClient } = await import('@libsql/client');
        const client = createClient({
          url: process.env.TURSO_DATABASE_URL,
          authToken: process.env.TURSO_AUTH_TOKEN
        });
        
        // 初始化表结构（添加超时保护）
        await Promise.race([
          initializeTables(client),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Turso 初始化超时（5秒）')), 5000)
          )
        ]);
        
        console.log('✅ Turso 数据库连接成功（后台连接）');
        
        // 重试函数（减少重试次数，加快失败响应）
        const retryOperation = async (operation, maxRetries = 2, delay = 500) => {
          for (let i = 0; i < maxRetries; i++) {
            try {
              return await operation();
            } catch (error) {
              const isTimeoutError = error.message?.includes('timeout') || 
                                    error.message?.includes('TIMEOUT') ||
                                    error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
                                    error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';
              
              if (isTimeoutError && i < maxRetries - 1) {
                console.warn(`⚠️ Turso 操作超时，${delay}ms 后重试 (${i + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
              }
              throw error;
            }
          }
        };
        
        // Turso 客户端接口（仅用于同步）
        tursoDb = {
          get: async (sql, params = []) => {
            return await retryOperation(async () => {
              const result = await client.execute({ sql, args: params });
              if (result.rows && result.rows.length > 0) {
                const row = result.rows[0];
                const record = {};
                if (result.columns) {
                  result.columns.forEach((col, i) => {
                    record[col] = row[i];
                  });
                } else {
                  return row;
                }
                return record;
              }
              return null;
            });
          },
          all: async (sql, params = []) => {
            return await retryOperation(async () => {
              const result = await client.execute({ sql, args: params });
              if (result.rows && result.columns) {
                return result.rows.map((row) => {
                  const record = {};
                  result.columns.forEach((col, i) => {
                    record[col] = row[i];
                  });
                  return record;
                });
              }
              return result.rows || [];
            });
          },
          run: async (sql, params = []) => {
            return await retryOperation(async () => {
              await client.execute({ sql, args: params });
              return { lastInsertRowid: null, changes: 0 };
            });
          },
          execute: async (sql, params = []) => {
            return await retryOperation(async () => {
              return await client.execute({ sql, args: params });
            });
          }
        };
        
        return tursoDb;
      } catch (error) {
        console.error('❌ Turso 连接失败（不影响主数据库）:', error.message || error);
        console.log('ℹ️ 将继续使用本地 SQLite 数据库');
        return null;
      }
    })();
    
    // 不等待连接完成，立即返回
    // 连接将在后台进行，server.js 中可以等待或检查连接状态
  } else if (!shouldUseTurso && process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    console.log('ℹ️ 检测到 Turso 配置，但未开启 USE_TURSO，使用本地 SQLite 数据库');
  }
  
  // 立即返回本地数据库，Turso 连接在后台进行
  console.log('✅ 数据库初始化完成（本地优先，Turso 后台连接）');
  return {
    primary: localDb,  // 主数据库，立即可用
    tursoClient: tursoConnectionPromise,  // Turso 连接 Promise，可以 await 或检查
    getTursoClient: async () => {
      // 辅助函数：等待 Turso 连接完成
      if (tursoConnectionPromise) {
        return await tursoConnectionPromise;
      }
      return null;
    }
  };
}

const PARSE_HISTORY_ALTER_STATEMENTS = [
  "ALTER TABLE article_parse_history ADD COLUMN parsed_source TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN parsed_platform TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN parsed_author TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN parsed_published_at TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN suggested_notebook_id TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN suggested_notebook_name TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN assigned_notebook_id TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN assigned_notebook_name TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN status TEXT DEFAULT 'processing'",
  "ALTER TABLE article_parse_history ADD COLUMN parse_query TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN coze_response_data TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN parsed_fields TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN tags TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN notes TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN note_ids TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP",
  "ALTER TABLE article_parse_history ADD COLUMN parsed_at TEXT",
  "ALTER TABLE article_parse_history ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP"
];

const isDuplicateColumnError = (error = {}) =>
  typeof error?.message === 'string' && error.message.includes('duplicate column name');

/**
 * 初始化数据库表结构（异步版本，用于 Turso）
 * @param {object} db - 数据库实例
 */
async function initializeTables(db) {
  const createParseHistoryTable = `
    CREATE TABLE IF NOT EXISTS article_parse_history (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      parsed_content TEXT,
      parsed_title TEXT,
      parsed_summary TEXT,
      parsed_source TEXT,
      parsed_platform TEXT,
      parsed_author TEXT,
      parsed_published_at TEXT,
      suggested_notebook_id TEXT,
      suggested_notebook_name TEXT,
      assigned_notebook_id TEXT,
      assigned_notebook_name TEXT,
      status TEXT DEFAULT 'processing',
      parse_query TEXT,
      coze_response_data TEXT,
      parsed_fields TEXT,
      tags TEXT,
      notes TEXT,
      note_ids TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      parsed_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createNotebooksTable = `
    CREATE TABLE IF NOT EXISTS notebooks (
      notebook_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      note_count INTEGER DEFAULT 0,
      component_config TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createNotesTable = `
    CREATE TABLE IF NOT EXISTS notes (
      note_id TEXT PRIMARY KEY,
      notebook_id TEXT,
      title TEXT NOT NULL,
      content_text TEXT,
      images TEXT,
      image_urls TEXT,
      source_url TEXT,
      source TEXT,
      original_url TEXT,
      author TEXT,
      upload_time TEXT,
      component_data TEXT,
      component_instances TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(notebook_id)
    )
  `;
  
  const createFieldTemplateTable = CREATE_FIELD_TEMPLATE_TABLE_SQL;
  const createFieldTemplatePreferenceTable = CREATE_FIELD_TEMPLATE_PREFERENCE_TABLE_SQL;
  const createAiFieldDefinitionsTable = CREATE_AI_FIELD_DEFINITIONS_TABLE_SQL;
  const createAiFieldValuesTable = CREATE_AI_FIELD_VALUES_TABLE_SQL;
  
  const createAnalysisResultsTable = `
    CREATE TABLE IF NOT EXISTS analysis_results (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      notebook_type TEXT,
      mode TEXT DEFAULT 'ai',
      analysis_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createAiAnalysisSettingTable = `
    CREATE TABLE IF NOT EXISTS ai_analysis_setting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id TEXT NOT NULL UNIQUE,
      notebook_type TEXT DEFAULT 'custom',
      config_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createAuthUsersTable = CREATE_AUTH_USERS_TABLE_SQL;
  const createAuthOauthAccountsTable = CREATE_AUTH_OAUTH_ACCOUNTS_TABLE_SQL;
  const createAuthSessionsTable = CREATE_AUTH_SESSIONS_TABLE_SQL;
  const createAuthTokensTable = CREATE_AUTH_TOKENS_TABLE_SQL;
  
  try {
    // 使用重试机制执行表创建
    const executeWithRetry = async (sql, maxRetries = 3, delay = 1000, ignoreDuplicateColumnErrors = false) => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          await db.execute(sql);
          return;
        } catch (error) {
          if (ignoreDuplicateColumnErrors && isDuplicateColumnError(error)) {
            return;
          }
          const isTimeoutError = error.message?.includes('timeout') || 
                                error.message?.includes('TIMEOUT') ||
                                error.message?.includes('fetch failed') ||
                                error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
                                error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';
          
          if (isTimeoutError && i < maxRetries - 1) {
            console.warn(`⚠️ 数据库操作超时，${delay}ms 后重试 (${i + 1}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
            continue;
          }
          throw error;
        }
      }
    };
    
    await executeWithRetry(createParseHistoryTable);
    await executeWithRetry(createNotebooksTable);
    await executeWithRetry(createNotesTable);
    await executeWithRetry(createAnalysisResultsTable);
    await executeWithRetry(createAiAnalysisSettingTable);
    await executeWithRetry(createFieldTemplateTable);
    await executeWithRetry(createFieldTemplatePreferenceTable);
    await executeWithRetry(createAiFieldDefinitionsTable);
    await executeWithRetry(createAiFieldValuesTable);
    await executeWithRetry(createAuthUsersTable);
    await executeWithRetry(createAuthOauthAccountsTable);
    await executeWithRetry(createAuthSessionsTable);
    await executeWithRetry(createAuthTokensTable);
    
    // 创建索引以优化查询性能
    const createIndexes = [
      // article_parse_history 表的索引
      `CREATE INDEX IF NOT EXISTS idx_parse_history_updated_at ON article_parse_history(updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_parse_history_created_at ON article_parse_history(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_parse_history_status ON article_parse_history(status)`,
      `CREATE INDEX IF NOT EXISTS idx_parse_history_suggested_notebook ON article_parse_history(suggested_notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_parse_history_assigned_notebook ON article_parse_history(assigned_notebook_id)`,
      // notes 表的索引
      `CREATE INDEX IF NOT EXISTS idx_notes_notebook_id ON notes(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC)`,
      // notebooks 表的索引
      `CREATE INDEX IF NOT EXISTS idx_notebooks_updated_at ON notebooks(updated_at DESC)`,
      // analysis_results 表的索引
      `CREATE INDEX IF NOT EXISTS idx_analysis_notebook_id ON analysis_results(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analysis_updated_at ON analysis_results(updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_field_template_notebook ON notebook_field_templates(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_field_template_source ON notebook_field_templates(source_type)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_field_def_notebook_key ON ai_field_definitions(notebook_id, field_key)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_field_values_field_note ON ai_field_values(field_def_id, note_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_field_values_note ON ai_field_values(note_id)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_type ON auth_tokens(user_id, type)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_oauth_user ON auth_oauth_accounts(user_id)`
    ];
    
    for (const indexSql of createIndexes) {
      try {
        await executeWithRetry(indexSql);
      } catch (indexError) {
        // 索引创建失败不影响主流程，只记录警告
        console.warn(`⚠️ 创建索引失败（可能已存在）: ${indexSql}`, indexError.message);
      }
    }
    for (const alterSql of PARSE_HISTORY_ALTER_STATEMENTS) {
      try {
        await executeWithRetry(alterSql, 2, 200, true);
      } catch (alterError) {
        console.warn(`⚠️ 扩展 article_parse_history 列失败（已忽略）: ${alterSql}`, alterError?.message || alterError);
      }
    }
    console.log('✅ 数据库表初始化完成');
  } catch (error) {
    console.error('❌ 数据库表初始化失败:', error);
    throw error;
  }
}

/**
 * 初始化数据库表结构（同步版本，用于 better-sqlite3）
 * @param {object} db - 数据库实例
 */
function initializeTablesSync(db) {
  const createParseHistoryTable = `
    CREATE TABLE IF NOT EXISTS article_parse_history (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      parsed_content TEXT,
      parsed_title TEXT,
      parsed_summary TEXT,
      parsed_source TEXT,
      parsed_platform TEXT,
      parsed_author TEXT,
      parsed_published_at TEXT,
      suggested_notebook_id TEXT,
      suggested_notebook_name TEXT,
      assigned_notebook_id TEXT,
      assigned_notebook_name TEXT,
      status TEXT DEFAULT 'processing',
      parse_query TEXT,
      coze_response_data TEXT,
      parsed_fields TEXT,
      tags TEXT,
      notes TEXT,
      note_ids TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      parsed_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createNotebooksTable = `
    CREATE TABLE IF NOT EXISTS notebooks (
      notebook_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      note_count INTEGER DEFAULT 0,
      component_config TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createNotesTable = `
    CREATE TABLE IF NOT EXISTS notes (
      note_id TEXT PRIMARY KEY,
      notebook_id TEXT,
      title TEXT NOT NULL,
      content_text TEXT,
      images TEXT,
      image_urls TEXT,
      source_url TEXT,
      source TEXT,
      original_url TEXT,
      author TEXT,
      upload_time TEXT,
      component_data TEXT,
      component_instances TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(notebook_id)
    )
  `;
  
  const createFieldTemplateTable = CREATE_FIELD_TEMPLATE_TABLE_SQL;
  const createFieldTemplatePreferenceTable = CREATE_FIELD_TEMPLATE_PREFERENCE_TABLE_SQL;
  const createAiFieldDefinitionsTable = CREATE_AI_FIELD_DEFINITIONS_TABLE_SQL;
  const createAiFieldValuesTable = CREATE_AI_FIELD_VALUES_TABLE_SQL;
  
  const createAnalysisResultsTable = `
    CREATE TABLE IF NOT EXISTS analysis_results (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      notebook_type TEXT,
      mode TEXT DEFAULT 'ai',
      analysis_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createAiAnalysisSettingTable = `
    CREATE TABLE IF NOT EXISTS ai_analysis_setting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id TEXT NOT NULL UNIQUE,
      notebook_type TEXT DEFAULT 'custom',
      config_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;
  const createAuthUsersTable = CREATE_AUTH_USERS_TABLE_SQL;
  const createAuthOauthAccountsTable = CREATE_AUTH_OAUTH_ACCOUNTS_TABLE_SQL;
  const createAuthSessionsTable = CREATE_AUTH_SESSIONS_TABLE_SQL;
  const createAuthTokensTable = CREATE_AUTH_TOKENS_TABLE_SQL;
  
  try {
    db.exec(createParseHistoryTable);
    db.exec(createNotebooksTable);
    db.exec(createNotesTable);
    db.exec(createAnalysisResultsTable);
    db.exec(createAiAnalysisSettingTable);
    db.exec(createFieldTemplateTable);
    db.exec(createFieldTemplatePreferenceTable);
    db.exec(createAiFieldDefinitionsTable);
    db.exec(createAiFieldValuesTable);
    db.exec(createAuthUsersTable);
    db.exec(createAuthOauthAccountsTable);
    db.exec(createAuthSessionsTable);
    db.exec(createAuthTokensTable);
    
    // 创建索引以优化查询性能
    const createIndexes = [
      // article_parse_history 表的索引
      `CREATE INDEX IF NOT EXISTS idx_parse_history_updated_at ON article_parse_history(updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_parse_history_created_at ON article_parse_history(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_parse_history_status ON article_parse_history(status)`,
      `CREATE INDEX IF NOT EXISTS idx_parse_history_suggested_notebook ON article_parse_history(suggested_notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_parse_history_assigned_notebook ON article_parse_history(assigned_notebook_id)`,
      // notes 表的索引
      `CREATE INDEX IF NOT EXISTS idx_notes_notebook_id ON notes(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC)`,
      // notebooks 表的索引
      `CREATE INDEX IF NOT EXISTS idx_notebooks_updated_at ON notebooks(updated_at DESC)`,
      // analysis_results 表的索引
      `CREATE INDEX IF NOT EXISTS idx_analysis_notebook_id ON analysis_results(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analysis_updated_at ON analysis_results(updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_field_template_notebook ON notebook_field_templates(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_field_template_source ON notebook_field_templates(source_type)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_field_def_notebook_key ON ai_field_definitions(notebook_id, field_key)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_field_values_field_note ON ai_field_values(field_def_id, note_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_field_values_note ON ai_field_values(note_id)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_type ON auth_tokens(user_id, type)`,
      `CREATE INDEX IF NOT EXISTS idx_auth_oauth_user ON auth_oauth_accounts(user_id)`
    ];
    
    for (const indexSql of createIndexes) {
      try {
        db.exec(indexSql);
      } catch (indexError) {
        // 索引创建失败不影响主流程，只记录警告
        if (!indexError.message.includes('already exists')) {
          console.warn(`⚠️ 创建索引失败（可能已存在）: ${indexSql}`, indexError.message);
        }
      }
    }
    console.log('✅ 数据库索引创建完成');

    for (const alterSql of PARSE_HISTORY_ALTER_STATEMENTS) {
      try {
        db.exec(alterSql);
      } catch (alterError) {
        if (!isDuplicateColumnError(alterError)) {
          console.warn(`⚠️ 扩展 article_parse_history 列失败（已忽略）: ${alterSql}`, alterError?.message || alterError);
        }
      }
    }
    
    // 迁移：确保 ai_analysis_setting 表有 config_data 列
    try {
      db.exec(`ALTER TABLE ai_analysis_setting ADD COLUMN config_data TEXT`);
      console.log('✅ 已添加 config_data 列到 ai_analysis_setting 表');
    } catch (alterError) {
      // 如果列已存在，忽略错误
      if (!alterError.message.includes('duplicate column')) {
        console.warn('⚠️ 添加 config_data 列时出现警告:', alterError.message);
      }
    }
    
    console.log('✅ 数据库表初始化完成');
  } catch (error) {
    console.error('❌ 数据库表初始化失败:', error);
    throw error;
  }
}
