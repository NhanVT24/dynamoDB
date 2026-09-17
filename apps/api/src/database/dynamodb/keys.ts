function normalizeProductId(id: string) {
  return String(id ?? "").trim().replace(/^PRODUCT#/i, "");
}

export const keys = {
  product(id: string) {
    const normalizedId = normalizeProductId(id);
    return {
      PK: `PRODUCT#${normalizedId}`,
      SK: "DETAIL"
    };
  },
  userAuthorization(subject: string) {
    return {
      PK: `USER#${String(subject).trim()}`,
      SK: "AUTHORIZATION"
    };
  },
  userProfile(subject: string) {
    return {
      PK: `USER#${String(subject).trim()}`,
      SK: "PROFILE"
    };
  }
};
