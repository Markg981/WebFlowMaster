# Synthetic mutual TLS fixtures

These publicly committed certificates and private keys are disposable test identities,
generated for the local gRPC test service. They have no production trust or credentials.
The CA signing key is deliberately absent. The server certificate identifies `localhost`.
Certificates are valid from 2026-10-04 through 2036-10-01; renew this fixture set before expiry.
The encrypted client-key passphrase is `fixture-passphrase`.

Tests exercise verified client authentication, encrypted keys, wrong trust, wrong identity,
wrong hostname, key mismatch, and execution through the authenticated agent relay.
