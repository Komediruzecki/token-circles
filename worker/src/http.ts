// Error carrying an HTTP status, mapped to a JSON response by the app.onError handler.
export class HttpError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}
