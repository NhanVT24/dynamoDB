export const keys = {
  product(id: string) {
    return {
      PK: `PRODUCT#${id}`,
      SK: "DETAIL"
    };
  }
};
