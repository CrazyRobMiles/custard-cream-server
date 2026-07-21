// Node port of edit_image() in custard-cream-camera's NanoBananaClient.py -
// same model, same "send prompt + image, read back inline image data" shape,
// talking to the same Gemini API key (GOOGLE_API_KEY) via the plain REST
// endpoint instead of the Python google-genai SDK (no Node SDK dependency
// needed - this project has no other Google package, and it's a single call).
const MODEL = 'gemini-2.5-flash-image';
const API_KEY_ENV = 'GOOGLE_API_KEY';
const TIMEOUT_MS = 30000;

// Resolves to { data: Buffer, mimeType: string } if the model returned an
// edited image, or { data: null, text: string|null } if it didn't (e.g. a
// safety refusal, or it just replied with text instead of an image).
async function editImage(imageBuffer, promptText, mimeType) {
    const apiKey = process.env[API_KEY_ENV];
    if (!apiKey) {
        throw new Error(
            `No API key found in environment variable '${API_KEY_ENV}' - get one from ` +
            'https://aistudio.google.com/apikey and set it in .env'
        );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
        response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: promptText },
                            { inlineData: { mimeType, data: imageBuffer.toString('base64') } }
                        ]
                    }]
                }),
                signal: controller.signal
            }
        );
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Nano Banana request timed out after ${TIMEOUT_MS / 1000}s`);
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Nano Banana request failed: ${response.status} ${errorBody}`);
    }

    const body = await response.json();
    const parts = body.candidates?.[0]?.content?.parts || [];

    const textParts = [];
    for (const part of parts) {
        if (part.inlineData) {
            return {
                data: Buffer.from(part.inlineData.data, 'base64'),
                mimeType: part.inlineData.mimeType
            };
        }
        if (part.text) {
            textParts.push(part.text);
        }
    }

    return { data: null, text: textParts.join(' ') || null };
}

module.exports = { editImage };
