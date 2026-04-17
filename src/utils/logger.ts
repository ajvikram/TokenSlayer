import * as vscode from 'vscode';

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

export class Logger {
  private static instance: Logger;
  private channel: vscode.OutputChannel;
  private level: LogLevel;

  private constructor() {
    this.channel = vscode.window.createOutputChannel('TokenSlayer');
    this.level = LogLevel.Info;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.Debug) {
      this.log('DEBUG', message, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.Info) {
      this.log('INFO', message, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.Warn) {
      this.log('WARN', message, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.Error) {
      this.log('ERROR', message, ...args);
    }
  }

  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }

  private log(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const extra = args.length > 0 ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : '';
    this.channel.appendLine(`[${timestamp}] [${level}] ${message}${extra}`);
  }
}
