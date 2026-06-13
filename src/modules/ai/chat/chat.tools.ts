import OpenAI from 'openai';

export const CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
    {
        type: 'function',
        function: {
            name: 'search_drug',
            description:
                'Search for a drug by name or symptoms. Call this when the user mentions a drug name or describes symptoms.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The drug name or symptom description to search for.',
                    },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'find_nearby_pharmacies',
            description:
                'Find pharmacies near the user that have a specific drug in stock. Call this after finding a drug.',
            parameters: {
                type: 'object',
                properties: {
                    drug_id: {
                        type: 'string',
                        description: 'The UUID of the drug to search for.',
                    },
                    lat: {
                        type: 'number',
                        description: "The user's latitude coordinate.",
                    },
                    lng: {
                        type: 'number',
                        description: "The user's longitude coordinate.",
                    },
                    radius_km: {
                        type: 'number',
                        description:
                            'Search radius in kilometers. Defaults to 10 if not provided.',
                    },
                },
                required: ['drug_id', 'lat', 'lng'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'find_alternatives',
            description:
                'Find alternative drugs with the same active ingredient. Call this when a drug is unavailable.',
            parameters: {
                type: 'object',
                properties: {
                    active_ingredient: {
                        type: 'string',
                        description:
                            'The active ingredient to search alternatives for. Must be UPPERCASE.',
                    },
                },
                required: ['active_ingredient'],
            },
        },
    },
];
