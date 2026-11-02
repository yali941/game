# Private game controls

The private login page is `/owner`. It is not linked from the public lobby.
This controls game actions only; it provides no hosting, filesystem or account-management access.

Set `OWNER_KEY_HASH` to the SHA-256 hex digest of a cryptographically random 32-byte key
(encode the key as base64url before hashing its text). Never commit the key or the environment value.
Without this configuration, login and all private actions fail closed. Do not use a human-chosen
password with this hash scheme. Keep the original random key in the owner's private password store.

Login binds an HttpOnly, SameSite=Strict cookie to the authenticated player profile for eight hours.
Render/production uses a Secure cookie. Only one owner login is active; a new login revokes the old one.
Restarting the service clears sessions and requires another login. The environment hash survives deploys.
Each action checks the session, profile, room membership, game type, turn and board version.
Nickname and publicly visible player ID never grant permission.

Controls:

- Standard Gomoku: enable one optional extra stone before the first move of the current turn.
  The existing explicit End Turn flow publishes one or two stones together.
- Flight: select 1–6 or random immediately before the owner's own roll. The selection is one-use
  and bound to the current room, round and version. Regular dice animation and three-sixes rule remain.
- Fog Gomoku: request a private full-board view. Normal snapshots and the opponent's fog are unchanged.
- Go: request legal points using the actual suicide and superko rules; undo the owner's last move
  only before the opponent replies, while in play phase and without a pending negotiation.

Actions/settings are not included in public player data, chat or rules. Results on a shared board
remain visible. A person with the private key can log in, so the owner must not share it.

To disable access, remove `OWNER_KEY_HASH` and redeploy. To rotate the key, configure a newly generated
key's hash and redeploy, then use the new key at `/owner`.

Validation: `node --test`, including `test/owner-access.test.js`.
