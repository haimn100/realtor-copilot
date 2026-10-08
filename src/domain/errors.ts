export class AppError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'UNAUTHENTICATED' | 'INVALID_INPUT' | 'DATA_ERROR', message: string) {
    super(message);
    this.name = 'AppError';
  }
}
