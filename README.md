# Gather

Shared expenses with Google sign-in for group creators and editable links for everyone else.

## Setup

1. Run these SQL migrations in order in the Supabase SQL Editor. For an existing installation, apply the migrations you have not run yet:
   - [Base group tables](supabase/migrations/202609070001_private_groups.sql)
   - [Group edit links](supabase/migrations/202609160002_group_edit_links.sql)
   - [Creator and link access](supabase/migrations/202609160003_creator_and_link_access.sql)
2. Enable **Google** in Supabase **Authentication ? Sign In / Providers** and enter your Google OAuth client ID and secret. In Google Cloud, configure a web OAuth client using the callback URL shown by Supabase (`https://YOUR_PROJECT.supabase.co/auth/v1/callback`). Follow the [Supabase Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).
3. Set the production website as Supabase's **Site URL** and allow its exact URL under **Redirect URLs**. Allow `http://localhost:3000/` for local development (or the actual port). Configure your Google OAuth app's audience/test users as needed. Google sign-in must be enabled in the hosted project; deploying code does not enable a provider.
4. The app no longer uses Supabase email/password signup, password resets, magic links or invitations. After confirming existing creators can access their groups through Google, disable the Email auth provider if you want to prevent those methods at the hosted API as well. Use the same Google email as the existing creator account; Supabase supports [automatic identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking) for matching emails.
5. Set these Vercel environment variables, then deploy:

   ```text
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
   ```

   A legacy `anon` key is also supported. Never use a secret or service-role key: these values are bundled into the browser. Google OAuth secrets belong in the Supabase provider configuration, never in frontend files.

[vercel.json](vercel.json) builds with `npm run build` and serves `dist`. Use Node.js 22 or later. Deployments do not run SQL migrations. Missing Vercel configuration fails the build.

## Creator and visitor flows

Creators choose **Continue with Google**, create groups, and manage their own groups. There are no app password or registration forms. Account recovery is handled by Google.

To share a group, choose **Share group**, copy its **Group edit link**, and send it yourself. Anyone with that complete link can immediately view and edit the group's expenses, repayments and participant names. Visitors need no account, email, password, OTP or membership. No Supabase email is sent by either flow.

Share links from your public website, not `localhost`: on another person's phone, `localhost` points to their own phone. Opening the deployed app and copying its link produces the public URL.

Links contain a random bearer key in the URL fragment (`#edit=...`). The fragment is excluded from normal HTTP page requests and referrer headers. Share the full link; anyone who receives or forwards it can edit. A group ID alone grants no access. **Replace link** invalidates the old key for subsequent reads and writes, while preserving the group and its data. Information already viewed or copied cannot be removed.

| Action | Creator | Anyone with edit link | Neither |
| --- | --- | --- | --- |
| View expenses and balances | Yes | Yes | No |
| Add/edit/delete expenses; record/undo repayments | Yes | Yes | No |
| Manage participant names | Yes | Yes | No |
| Close/reopen/delete group; replace link | Yes | No | No |

Closed groups remain readable through their links; only the creator can reopen them. Link mode shows only the linked group, even if the browser has a signed-in creator account. **Go to my account** leaves link mode.

The creator-and-link migration removes the obsolete invitation RPCs and stops account memberships from granting access. Historical membership/invitation records are retained without client access, and group documents and existing edit links are preserved. Historical migrations remain in the repository so both new and existing databases can be upgraded safely.

## Storage and existing data

Groups are saved in Supabase and are not cached in localStorage. Creator sessions persist in the browser, so sign out on shared browser profiles. Groups refresh on focus, every 30 seconds while visible and outside a dialog, or through **Refresh groups**. Version checks reject stale edits rather than overwrite someone else's work.

RLS protects ordinary table access. Dedicated database functions validate the edit key on every link read and write. Keys are stored in a private table and never included in group records. Clients cannot directly change ownership. Project administrators retain database access; this is not end-to-end encryption.

For older browser-only data, sign in on the same browser and app address and choose **Import browser groups**. You become the creator of the imported groups. IDs, expenses, splits and repayments are preserved; retries skip groups you already own. The original `gather-expenses-v2` localStorage backup remains untouched.

## Troubleshooting

If **Share group** reports `Could not find the function public.gather_edit_link(gid, replace_link) in the schema cache`, run the entire [edit link migration](supabase/migrations/202609160002_group_edit_links.sql) in the Supabase project used by the app. It can be rerun without changing existing links or deleting data, and refreshes the schema cache. Reload the app afterward.

If the functions are installed but the cache is stale, run `NOTIFY pgrst, 'reload schema';` as described in [Supabase's instructions](https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema).

## Local development and validation

```powershell
npm.cmd ci
Copy-Item .env.example .env
# Fill in the Supabase URL and publishable key.
npm.cmd run dev
npm.cmd test
npm.cmd run test:browser
```

The development server normally uses port 3000 and tries the next port when busy. Rebuild/restart after frontend changes. Missing local configuration displays a setup message.

Tests execute the SQL migrations in PGlite (embedded Postgres), including upgrades from legacy memberships to creator/link access, anonymous link edits, replacement, group isolation and stale writes. Adapter tests cover Google login and link RPCs. The browser suite uses a test-only cloud fixture and checks sign-in errors, group workflows, anonymous edits and persistence. It does not test real Google OAuth or hosted Supabase; verify creator sign-in and anonymous link editing on the deployed site. Set `CHROME_PATH` if needed or `TEST_URL` to use a running build. Fixtures are never deployed.

Amounts use integer paise. Splits support even, exact amounts, weighted shares and percentages. Repayments adjust balances without transferring money.
