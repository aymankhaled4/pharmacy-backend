import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SupabaseService } from '../../../database/supabase.service';
import { OpenAiService } from '../openai.service';
import { ExcelImportController } from './excel-import.controller';
import { ExcelImportService } from './excel-import.service';
import { ColumnMapperService } from './column-mapper';
import { DrugMatcherService } from './drug-matcher';
import { ImportQueueProcessor, IMPORT_QUEUE } from './import-queue.processor';

@Module({
    imports: [
        BullModule.registerQueue({ name: IMPORT_QUEUE }),
    ],
    controllers: [ExcelImportController],
    providers: [
        ExcelImportService,
        ColumnMapperService,
        DrugMatcherService,
        ImportQueueProcessor,
        OpenAiService,
        SupabaseService,
    ],
})
export class ExcelImportModule { }
