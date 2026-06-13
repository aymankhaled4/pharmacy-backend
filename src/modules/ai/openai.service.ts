import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenAiService {
    private readonly client: OpenAI;

    constructor(private readonly config: ConfigService) {
        // Support both GEMINI_API_KEY and OPENAI_API_KEY
        const apiKey =
            this.config.get<string>('GEMINI_API_KEY') ??
            this.config.get<string>('OPENAI_API_KEY');

        const isGemini = !!this.config.get<string>('GEMINI_API_KEY');

        this.client = new OpenAI({
            apiKey,
            ...(isGemini && {
                baseURL:
                    'https://generativelanguage.googleapis.com/v1beta/openai/',
            }),
        });
    }

    chat(
        params: OpenAI.Chat.ChatCompletionCreateParams,
    ): Promise<OpenAI.Chat.ChatCompletion> {
        return this.client.chat.completions.create({
            ...params,
            stream: false,
        }) as Promise<OpenAI.Chat.ChatCompletion>;
    }
}
