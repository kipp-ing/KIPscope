## ADDED Requirements

### Requirement: Signed-in user in the footer
With an identity other than `none` the footer SHALL show the signed-in user's ID as the last automatic meta item, with the tooltip `Signed in as <user> (<identity>) · roles: <roles>` (`none` when there are none); with `none` it SHALL show no user item. Origin: necessary consequence of D-083 and D-084 (several users with different rights on one server: the user must see as whom and with which roles they act); design M12.

#### Scenario: User item
- **WHEN** `footerItems` gets the meta of "Items from meta" with `me` `{user: "alice", identity: "oidc", roles: ["testers", "viewers"], …}`, then `{user: "bob", identity: "oidc", roles: [], …}`, then `{user: "local", identity: "none", …}`, then without `me`
- **THEN** the first returns the four items of "Items from meta" followed by `alice` with the tooltip `Signed in as alice (oidc) · roles: testers, viewers`; the second ends with `bob` and `roles: none`; the third and fourth return the four items only
- **Evidence:** `apps/web/test/footer.test.ts` › "shows the signed-in user"
