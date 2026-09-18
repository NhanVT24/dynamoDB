import assert from "node:assert/strict";
import test from "node:test";

const linking = await import("../dist/src/entrypoints/lambda/cognito/helper/external-provider-linking.js");

function user(username, attributes = []) {
  return {
    Username: username,
    Attributes: attributes
  };
}

function identities(providerName = "Google") {
  return [{ Name: "identities", Value: JSON.stringify([{ providerName }]) }];
}

test("native sign-up is rejected when email already belongs to a federated account", async () => {
  const sentCommands = [];
  const fakeCognito = {
    async send(command) {
      sentCommands.push(command);
      return {
        Users: [
          user("Google_123", [
            { Name: "email", Value: "buyer@example.com" },
            ...identities()
          ])
        ]
      };
    }
  };

  await assert.rejects(
    () => linking.assertEmailNotAlreadyRegistered("pool-1", "buyer@example.com", fakeCognito),
    /already exists/
  );
  assert.equal(sentCommands[0].constructor.name, "ListUsersCommand");
});

test("external provider linking prefers the native Cognito user for duplicate legacy emails", async () => {
  const sentCommands = [];
  const fakeCognito = {
    async send(command) {
      sentCommands.push(command);

      if (command.constructor.name === "ListUsersCommand") {
        return {
          Users: [
            user("Google_legacy", [
              { Name: "email", Value: "buyer@example.com" },
              ...identities()
            ]),
            user("native-user", [
              { Name: "email", Value: "buyer@example.com" }
            ])
          ]
        };
      }

      return {};
    }
  };

  await linking.linkExternalProviderToNativeUser({
    userPoolId: "pool-1",
    userName: "Google_456",
    request: { userAttributes: { email: "buyer@example.com" } },
    response: {}
  }, "buyer@example.com", fakeCognito);

  const linkCommand = sentCommands.find((command) => command.constructor.name === "AdminLinkProviderForUserCommand");
  assert.equal(linkCommand.input.DestinationUser.ProviderName, "Cognito");
  assert.equal(linkCommand.input.DestinationUser.ProviderAttributeValue, "native-user");
  assert.equal(linkCommand.input.SourceUser.ProviderName, "Google");
  assert.equal(linkCommand.input.SourceUser.ProviderAttributeValue, "456");
});
