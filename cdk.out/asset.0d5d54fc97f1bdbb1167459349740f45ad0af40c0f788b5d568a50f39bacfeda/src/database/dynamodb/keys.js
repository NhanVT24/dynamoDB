export const keys = {
    product(id) {
        return {
            PK: `PRODUCT#${id}`,
            SK: "DETAIL"
        };
    }
};
