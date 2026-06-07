import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterFcmTokenDto {
  @ApiProperty({ example: 'fME9v2...' })
  @IsString()
  @IsNotEmpty()
  fcm_token!: string;
}