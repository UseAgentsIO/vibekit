import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface SqliteStatement {
  run(...params: SqlValue[]): void;
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
  all(...params: SqlValue[]): Record<string, unknown>[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqlValue = string | number | bigint | null;

interface NodeSqliteModule {
  DatabaseSync: new (
    path: string,
    options?: { timeout?: number },
  ) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: SqlValue[]): unknown;
      get(...params: SqlValue[]): Record<string, unknown> | undefined;
      all(...params: SqlValue[]): Record<string, unknown>[];
    };
    close(): void;
  };
}

interface BetterSqliteConstructor {
  new (path: string): {
    exec(sql: string): unknown;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown;
    };
    close(): void;
  };
}

export function isSqliteAvailable(): boolean {
  return tryLoadNodeSqlite() !== undefined || tryLoadBetterSqlite() !== undefined;
}

export function openSqliteDatabase(dbPath: string): SqliteDatabase {
  const nodeSqlite = tryLoadNodeSqlite();
  if (nodeSqlite !== undefined) {
    return wrapNodeSqlite(new nodeSqlite.DatabaseSync(dbPath, { timeout: 5000 }));
  }
  const BetterSqlite = tryLoadBetterSqlite();
  if (BetterSqlite !== undefined) {
    return wrapBetterSqlite(new BetterSqlite(dbPath));
  }
  throw new Error(
    "SQLite is unavailable. Use Node.js 22+ (built-in node:sqlite) or install the optional better-sqlite3 dependency.",
  );
}

function tryLoadNodeSqlite(): NodeSqliteModule | undefined {
  try {
    const mod = require("node:sqlite") as Partial<NodeSqliteModule>;
    if (typeof mod.DatabaseSync === "function") {
      return mod as NodeSqliteModule;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function tryLoadBetterSqlite(): BetterSqliteConstructor | undefined {
  try {
    const mod = require("better-sqlite3") as BetterSqliteConstructor | { default?: BetterSqliteConstructor };
    if (typeof mod === "function") {
      return mod;
    }
    if (typeof mod.default === "function") {
      return mod.default;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function wrapNodeSqlite(db: InstanceType<NodeSqliteModule["DatabaseSync"]>): SqliteDatabase {
  return {
    exec(sql) {
      db.exec(sql);
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        run: (...params) => {
          statement.run(...params);
        },
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
      };
    },
    close() {
      db.close();
    },
  };
}

function wrapBetterSqlite(db: InstanceType<BetterSqliteConstructor>): SqliteDatabase {
  return {
    exec(sql) {
      db.exec(sql);
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        run: (...params) => {
          statement.run(...params);
        },
        get: (...params) => statement.get(...params) as Record<string, unknown> | undefined,
        all: (...params) => statement.all(...params) as Record<string, unknown>[],
      };
    },
    close() {
      db.close();
    },
  };
}
