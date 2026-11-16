import { DatabaseSync } from 'node:sqlite'

export class CommandHistory {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS history (command TEXT NOT NULL UNIQUE);
    `)
  }

  list(): string[] {
    return this.db.prepare('SELECT command FROM history ORDER BY rowid DESC LIMIT 300').all()
      .map(row => String(row.command))
  }

  record(line: string): void {
    const command = line.trim()
    if (!command || /[\x00-\x1f\x7f]/.test(command)) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT OR REPLACE INTO history(command) VALUES (?)').run(command)
      this.db.exec('DELETE FROM history WHERE rowid <= (SELECT rowid FROM history ORDER BY rowid DESC LIMIT 1 OFFSET 300)')
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void { this.db.close() }
}
