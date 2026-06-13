import {
    BadRequestException,
    Controller,
    Get,
    NotFoundException,
    Param,
    Post,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { ExcelImportService } from './excel-import.service';
import { ExcelParser } from './excel-parser';
import { IMPORT_QUEUE } from './import-queue.processor';

const ALLOWED_EXT = new Set(['.xlsx', '.xls']);
const ALLOWED_MIME = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
]);
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const SYNC_ROW_LIMIT = 200;

@ApiTags('Excel Import')
@ApiBearerAuth()
@Controller('pharmacy/inventory')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('pharmacy')
export class ExcelImportController {
    constructor(
        private readonly importService: ExcelImportService,
        @InjectQueue(IMPORT_QUEUE) private readonly importQueue: Queue,
    ) { }

    @Post('import')
    @ApiOperation({ summary: 'Upload pharmacy inventory Excel file' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file'))
    async upload(
        @CurrentUser() user: AuthUser,
        @UploadedFile() file: Express.Multer.File | undefined,
    ) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        if (file.size > MAX_SIZE_BYTES) {
            throw new BadRequestException('File exceeds maximum size of 10MB');
        }

        const ext = this.getExtension(file.originalname);
        if (!ALLOWED_EXT.has(ext) && !ALLOWED_MIME.has(file.mimetype)) {
            throw new BadRequestException(
                'Invalid file type. Only .xlsx and .xls files are accepted',
            );
        }

        const { rows } = ExcelParser.parse(file.buffer);

        if (rows.length <= SYNC_ROW_LIMIT) {
            return this.importService.processFile(file.buffer, user.id);
        }

        // Large file — enqueue with retry support
        const job = await this.importQueue.add(
            { pharmacyId: user.id, bufferBase64: file.buffer.toString('base64') },
            { attempts: 3 },
        );

        return { jobId: String(job.id), queued: true, rowCount: rows.length };
    }

    @Get('import/:jobId')
    @ApiOperation({ summary: 'Get Excel import job status' })
    async status(@Param('jobId') jobId: string) {
        const job = await this.importQueue.getJob(jobId);

        if (!job) {
            throw new NotFoundException(`Import job ${jobId} not found`);
        }

        const state = await job.getState();
        const progress = job.progress();
        const result = state === 'completed' ? (job.returnvalue as unknown) : null;

        return { jobId, state, progress, result };
    }

    private getExtension(filename: string): string {
        const idx = filename.lastIndexOf('.');
        if (idx === -1) return '';
        return filename.slice(idx).toLowerCase();
    }
}
