import { HomeSections, StorefrontProvider, StorefrontShell } from "./store/store-client";

export default function HomePage() {
  return (
    <StorefrontProvider>
      <StorefrontShell>
        <HomeSections />
      </StorefrontShell>
    </StorefrontProvider>
  );
}
