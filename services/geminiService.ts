
import { GoogleGenAI, Type } from "@google/genai";
import type { BoundingBox } from '../types';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const model = 'gemini-3-pro-preview'; 

const schema = {
  type: Type.OBJECT,
  properties: {
    cars: {
      type: Type.ARRAY,
      items: {
        type: Type.ARRAY,
        items: { type: Type.NUMBER },
        description: "Bounding box coordinates [ymin, xmin, ymax, xmax]"
      },
      description: "An array of bounding boxes for detected cars."
    }
  },
  required: ['cars']
};

export const detectCarsInFrame = async (base64Image: string): Promise<BoundingBox[]> => {
  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          { 
            text: "Detect all cars in this image. Respond ONLY with a JSON object containing a key 'cars' which is an array of bounding boxes. Each bounding box should be a normalized array of four numbers: [ymin, xmin, ymax, xmax]. If no cars are found, the 'cars' array should be empty. Do not include motorcycles, buses, or trucks unless they are standard passenger cars."
          },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image,
            },
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const jsonString = response.text;
    if (!jsonString) {
      console.warn("Gemini API returned an empty response.");
      return [];
    }

    const parsed = JSON.parse(jsonString);
    if (parsed && Array.isArray(parsed.cars)) {
      // Basic validation for each bounding box
      return parsed.cars.filter((box: any) => 
        Array.isArray(box) && 
        box.length === 4 && 
        box.every(coord => typeof coord === 'number' && coord >= 0 && coord <= 1)
      ) as BoundingBox[];
    }
    return [];
  } catch (error) {
    console.error("Error processing request to Gemini API:", error);
    throw new Error("Failed to get detections from Gemini API.");
  }
};
