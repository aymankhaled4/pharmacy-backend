import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({ example: '0f0f0f0f-1111-2222-3333-444444444444' })
  @IsUUID()
  inventoryId!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
