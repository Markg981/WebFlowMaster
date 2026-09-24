import { storage } from '../server/storage';
import { passwordResetLink } from '../server/password-reset';

/**
 * A password reset link for any person, issued by whoever runs the installation.
 *
 *   node dist/password-reset-link.js <username>        (built, as in the Docker images)
 *   npm run user:reset-link -- <username>              (from source)
 *
 * The way back in for someone nobody in their organization can help: its only owner, who forgot
 * their password. An owner issues links for their members from Settings > Members; this is the
 * operator's equivalent, with access to the machine as the credential. The link is printed once,
 * lasts a day and works once; the organization's audit log records that the operator issued it.
 */

async function main() {
  const username = process.argv[2]?.trim();
  if (!username) {
    console.error('Usage: password-reset-link <username>');
    process.exit(2);
  }

  const issued = await storage.issuePasswordResetAsOperator(username);
  if (!issued) {
    console.error(`No person is called "${username}" on this installation.`);
    process.exit(1);
  }

  const origin = process.env.WEBFLOW_PUBLIC_URL?.trim() || `http://localhost:${process.env.PORT || 5000}`;
  console.log(`Password reset link for ${issued.username}, valid until ${issued.expiresAt.toISOString()}:`);
  console.log(passwordResetLink(origin, issued));
  if (!process.env.WEBFLOW_PUBLIC_URL) {
    console.log('(WEBFLOW_PUBLIC_URL is not set: replace the address with the one people open.)');
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
