import { digitallySignPDF } from "./digital-signing.js";

self.onmessage = async ({ data }) => {
  try {
    const result = await digitallySignPDF(data.pdf, data.certificate, data.password);
    self.postMessage({ result }, [result.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || "The PDF could not be digitally signed." });
  }
};
