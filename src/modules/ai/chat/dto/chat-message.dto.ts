import {
    IsArray,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from 'class-validator';
import OpenAI from 'openai';

export class ChatMessageDto {
    @IsString()
    @IsNotEmpty()
    message!: string;

    @IsOptional()
    @IsArray()
    conversationHistory?: OpenAI.Chat.ChatCompletionMessageParam[];

    @IsOptional()
    @IsNumber()
    latitude?: number;

    @IsOptional()
    @IsNumber()
    longitude?: number;
}
