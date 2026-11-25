export function pdfOpenErrorMessage(error) {
  const message = error?.message ?? "";
  if (/dynamically imported module|importing a module script|loading chunk|setting up fake worker failed/i.test(message)) {
    return "The PDF tools could not load. Reload Inkdesk and try again.";
  }
  if (/password|encrypt/i.test(message)) {
    return "This PDF is password-protected. Upload an unlocked copy.";
  }
  if (error?.name === "CertificationError" || message.startsWith("Choose")) {
    return message;
  }
  if (error?.name === "QuotaExceededError") {
    return "Your device storage is full. Free up space and try again.";
  }
  return "This PDF could not be opened. Try a valid, undamaged PDF.";
}
