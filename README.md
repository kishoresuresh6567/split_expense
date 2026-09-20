# Gather

Shared expenses with Google sign-in for everyone, including people opening editable group links.

## Setup

1. Run these SQL migrations in order in the Supabase SQL Editor. For an existing installation, apply the migrations you have not run yet:
   - [Base group tables](supabase/migrations/202609070001_private_groups.sql)
   - [Group edit links](supabase/migrations/202609160002_group_edit_links.sql)
   - [Creator and link access](supabase/migrations/202609160003_creator_and_link_access.sql)
   - [Google sign-in for shared links](supabase/migrations/202609200001_google_sign_in_for_links.sql)
   - [Member email access](supabase/migrations/202609200002_member_email_access.sql)
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

## Group access

Everyone chooses **Continue with Google**. Creators can add an optional Google email for each participant when creating a group or under **Manage members**. After signing in with that address, the participant sees the group in their normal group list without a shared URL. The creator alone can assign or remove access emails; removing an email revokes that access.

To share with someone who is not listed by email, choose **Share group**, copy its **Group edit link**, and send it yourself. A recipient must sign in with Google before opening the link. The app sends no invitation email.

Share links from your public website, not `localhost`: on another person's phone, `localhost` points to their own phone. Opening the deployed app and copying its link produces the public URL.

Links contain a random bearer key in the URL fragment (`#edit=...`). The fragment is excluded from normal HTTP page requests and referrer headers. Share the full link; anyone signed in with Google who receives or forwards it can edit. A group ID alone grants no access. **Replace link** invalidates the old key for subsequent reads and writes, while preserving the group and its data. Information already viewed or copied cannot be removed.

| Action | Creator | Listed email | Signed-in link holder |
| --- | --- | --- | --- |
| View expenses and balances | Yes | Yes | Yes |
| Add/edit/delete expenses; record/undo repayments | Yes | Yes | Yes |
| Manage participants and their access emails | Yes | No | No |
| Close/reopen/delete group; replace link | Yes | No | No |

Closed groups remain readable by listed members and through their links; only the creator can reopen them. Link mode shows only the linked group, even if the browser has a signed-in creator account. **Go to my account** leaves link mode.

The creator-and-link migration removes the obsolete invitation RPCs and stops account memberships from granting access. Historical membership/invitation records are retained without client access, and group documents and existing edit links are preserved. Historical migrations remain in the repository so both new and existing databases can be upgraded safely.

## Storage and existing data

Groups are saved in Supabase and are not cached in localStorage. Google sessions persist in the browser, so sign out on shared browser profiles. Groups refresh on focus, every 30 seconds while visible and outside a dialog, or through **Refresh groups**. Version checks reject stale edits rather than overwrite someone else's work.

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

Tests execute the SQL migrations in PGlite (embedded Postgres), including the upgrade from anonymous links to signed-in link access, replacement, group isolation and stale writes. Adapter tests cover Google login and link RPCs. The browser suite uses a test-only cloud fixture and checks sign-in errors, group workflows, signed-in link edits and persistence. It does not test real Google OAuth or hosted Supabase; verify Google sign-in for creators and shared-link visitors on the deployed site. Set `CHROME_PATH` if needed or `TEST_URL` to use a running build. Fixtures are never deployed.

Amounts use integer paise. Splits support even, exact amounts, weighted shares and percentages. Repayments adjust balances without transferring money.
