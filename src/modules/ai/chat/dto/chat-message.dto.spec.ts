import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ChatMessageDto } from './chat-message.dto';

async function validateDto(plain: object): Promise<string[]> {
    const dto = plainToInstance(ChatMessageDto, plain);
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('ChatMessageDto', () => {
    // Test 1: Body with message only passes validation
    it('should pass validation with message only', async () => {
        const errors = await validateDto({ message: 'Find me Panadol' });
        expect(errors).toHaveLength(0);
    });

    // Test 2: Empty string message → fails
    it('should fail validation with empty string message', async () => {
        const errors = await validateDto({ message: '' });
        expect(errors.length).toBeGreaterThan(0);
    });

    // Test 3: Missing message → fails
    it('should fail validation with missing message', async () => {
        const errors = await validateDto({});
        expect(errors.length).toBeGreaterThan(0);
    });

    // Test 4: conversationHistory missing → valid
    it('should pass without conversationHistory (it is optional)', async () => {
        const errors = await validateDto({ message: 'Hello' });
        expect(errors).toHaveLength(0);
    });

    // Test 5: Non-number latitude → fails
    it('should fail validation when latitude is not a number', async () => {
        const errors = await validateDto({ message: 'test', latitude: 'not-a-number' });
        expect(errors.length).toBeGreaterThan(0);
    });
});
