## ADDED Requirements

### Requirement: Signed-in user in the footer
In `header` mode the footer SHALL show the signed-in user's ID as the last automatic meta item, with the tooltip `Signed in as <user> (SSO)`; in `none` mode it SHALL show no user item. Origin: necessary consequence of D-083 (several users on one server: the user must see as whom they act); design M12.

#### Scenario: User item
- **WHEN** `footerItems` gets the meta of "Items from meta" with `me` `{user: "alice", auth: "header"}`, then with `{user: "local", auth: "none"}`, then without `me`
- **THEN** the first returns the four items of "Items from meta" followed by `alice` with a tooltip containing `Signed in as alice`; the second and third return the four items only
- **Evidence:** `apps/web/test/footer.test.ts` › "shows the signed-in user"
