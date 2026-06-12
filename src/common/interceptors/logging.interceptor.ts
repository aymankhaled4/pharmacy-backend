import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'crypto';
import { LoggerService } from '../../shared/logger/logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const requestId = randomUUID();
    const startTime = Date.now();

    request.requestId = requestId;

    return next.handle().pipe(
      tap(() => {
        this.logger.logRequest({
          requestId,
          userId: request.user?.id,
          method: request.method,
          path: request.url,
          statusCode: response.statusCode,
          durationMs: Date.now() - startTime,
        });
      }),
    );
  }
}
