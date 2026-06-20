import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export type DashboardPeriod = '7d' | '30d' | '90d';

export class DashboardQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '7d' })
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  period?: DashboardPeriod = '7d';
}
