export async function signWithCertificate(blob, certificate, password) {
  if (!certificate || certificate.size > 2 * 1024 * 1024) {
    throw new Error("Choose a .p12 or .pfx certificate smaller than 2 MB.");
  }
  const pdf = await blob.arrayBuffer();
  const certificateBytes = await certificate.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./digital-signing.worker.js", import.meta.url), { type: "module" });
    const finish = (error, result) => {
      clearTimeout(timeout);
      worker.terminate(); // The decrypted private key lives only in this worker.
      if (error) reject(new Error(error));
      else resolve(new Blob([result], { type: "application/pdf" }));
    };
    const timeout = setTimeout(() => finish("Signing took too long. Please try again."), 120000);
    worker.onmessage = ({ data }) => finish(data.error, data.result);
    worker.onerror = () => finish("The signing worker could not start. Reload and try again.");
    worker.postMessage({ pdf, certificate: certificateBytes, password }, [pdf, certificateBytes]);
  });
}
