export type UserWard = { name: string; houseNumber: string; streetNumber: string };
export type UserAddress = { ward: UserWard; city: string; province: string };

export function emptyAddress(): UserAddress {
  return { ward: { name: "", houseNumber: "", streetNumber: "" }, city: "", province: "" };
}

export function addressLabel(address: UserAddress): string {
  return [address.ward.houseNumber, address.ward.streetNumber, address.ward.name, address.city, address.province]
    .filter(Boolean).join(", ");
}

export function normalizeAddressDraft(addresses: UserAddress[]): UserAddress[] {
  return addresses.map((address) => ({
    ward: {
      name: address.ward.name.trim(),
      houseNumber: address.ward.houseNumber.trim(),
      streetNumber: address.ward.streetNumber.trim()
    },
    city: address.city.trim(), province: address.province.trim()
  })).filter((address) => address.ward.name || address.ward.houseNumber || address.ward.streetNumber || address.city || address.province);
}

export type AddressDraftField = "city" | "province" | keyof UserWard;

export function updateAddressField(address: UserAddress, field: AddressDraftField, value: string): UserAddress {
  return field === "city" || field === "province"
    ? { ...address, [field]: value }
    : { ...address, ward: { ...address.ward, [field]: value } };
}
