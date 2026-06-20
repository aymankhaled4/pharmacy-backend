import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class BulkUserIdsDto {
  @ApiProperty({
    example: [
      '33484010-24ca-4a1b-aa2e-34b704463f70',
      '2f3217c1-f6db-4909-b560-4626b79ed501',
    ],
    description: 'User profile IDs to update',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  user_ids!: string[];
}
