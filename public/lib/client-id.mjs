function createClientId(cryptoObject = globalThis.crypto, random = Math.random) {
  if (typeof cryptoObject?.randomUUID === "function") {
    try {
      return cryptoObject.randomUUID();
    } catch {
      // Some browsers expose the method but reject it outside a secure context.
    }
  }

  const bytes = new Uint8Array(16);
  let populated = false;
  if (typeof cryptoObject?.getRandomValues === "function") {
    try {
      cryptoObject.getRandomValues(bytes);
      populated = true;
    } catch {
      // Fall through for older HTTP-only browser environments.
    }
  }
  if (!populated) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export { createClientId };
