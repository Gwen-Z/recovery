/**
 * 数据库初始化
 * 支持 SQLite (better-sqlite3) 和 Turso
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const normalizeBoolean = (value) => {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

/**
 * 初始化数据库连接
 * @returns {Promise<object>} 数据库实例
 */
export async function initDB() {
  const shouldUseTurso = normalizeBoolean(process.env.USE_TURSO);

  // 仅当显式开启 USE_TURSO 时才连接远程数据库，避免本地开发误连
  if (shouldUseTurso && process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    try {
      console.log('🔌 尝试连接 Turso 数据库:', process.env.TURSO_DATABASE_URL);
      const { createClient } = await import('@libsql/client');
      console.log('✅ 已加载 @libsql/client 模块');
      const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
      });
      
      // 初始化表结构
      await initializeTables(client);
      
      console.log('✅ Turso 数据库连接成功');

      // 返回 Turso 兼容的接口
      return {
        get: async (sql, params = []) => {
          const result = await client.execute({ sql, args: params });
          if (result.rows && result.rows.length > 0) {
            const row = result.rows[0];
            const record = {};
            if (result.columns) {
              result.columns.forEach((col, i) => {
                record[col] = row[i];
              });
            } else {
              // 如果没有 columns，假设是对象数组
              return row;
            }
            return record;
          }
          return null;
        },
        all: async (sql, params = []) => {
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
        },
        run: async (sql, params = []) => {
          await client.execute({ sql, args: params });
          return { lastInsertRowid: null, changes: 0 };
        },
        execute: async (sql, params = []) => {
          return await client.execute({ sql, args: params });
        }
      };
    } catch (error) {
      console.error('❌ Turso 初始化失败，回退到 SQLite:', error);
      // 回退到 SQLite
    }
  } else if (!shouldUseTurso && process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    console.log('ℹ️ 检测到 Turso 配置，但未开启 USE_TURSO，使用本地 SQLite 数据库');
  }
  
  // 使用 SQLite (better-sqlite3)
  const Database = (await import('better-sqlite3')).default;
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data.db');
  console.log('⚠️ 使用本地 SQLite 数据库:', dbPath);
  const db = new Database(dbPath);
  
  // 初始化表结构（better-sqlite3 是同步的）
  initializeTablesSync(db);
  
  // 返回 better-sqlite3 兼容的接口（包装为异步）
  return {
    get: async (sql, params = []) => {
      try {
        const stmt = db.prepare(sql);
        return stmt.get(...params) || null;
      } catch (error) {
        console.error('❌ 数据库查询失败:', error);
        throw error;
      }
    },
    all: async (sql, params = []) => {
      try {
        const stmt = db.prepare(sql);
        return stmt.all(...params) || [];
      } catch (error) {
        console.error('❌ 数据库查询失败:', error);
        throw error;
      }
    },
    run: async (sql, params = []) => {
      try {
        const stmt = db.prepare(sql);
        const result = stmt.run(...params);
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      } catch (error) {
        console.error('❌ 数据库执行失败:', error);
        throw error;
      }
    },
    execute: async (sql, params = []) => {
      try {
        const stmt = db.prepare(sql);
        return stmt.run(...params);
      } catch (error) {
        console.error('❌ 数据库执行失败:', error);
        throw error;
      }
    }
  };
}

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
  
  try {
    await db.execute(createParseHistoryTable);
    await db.execute(createNotebooksTable);
    await db.execute(createNotesTable);
    await db.execute(createAnalysisResultsTable);
    await db.execute(createAiAnalysisSettingTable);
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
  
  try {
    db.exec(createParseHistoryTable);
    db.exec(createNotebooksTable);
    db.exec(createNotesTable);
    db.exec(createAnalysisResultsTable);
    db.exec(createAiAnalysisSettingTable);
    console.log('✅ 数据库表初始化完成');
  } catch (error) {
    console.error('❌ 数据库表初始化失败:', error);
    throw error;
  }
}

