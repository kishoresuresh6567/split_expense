# Gather

Shared expenses with Google sign-in for everyone, including people opening editable group links.

## Setup

1. Run these SQL migrations in order in the Supabase SQL Editor. For an existing installation, apply the migrations you have not run yet:
   - [Base group tables](supabase/migrations/202609070001_private_groups.sql)
   - [Group edit links](supabase/migrations/202609160002_group_edit_links.sql)
   - [Creator and link access](supabase/migrations/202609160003_creator_and_link_access.sql)
   - [Google sign-in for shared links](supabase/migrations/202609200001_google_sign_in_for_links.sql)
   - [Member email access](supabase/migrations/202609200002_member_email_access.sql)
   - [Links require listed email](supabase/migrations/202609200003_links_require_listed_email.sql)
   - [Member display names](supabase/migrations/202609200004_member_display_names.sql)
   - [Member management](supabase/migrations/202609200005_member_management.sql)
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

Everyone chooses **Continue with Google**. On first sign-in the app asks each person for the name they want other group members to see; they can change it later using **Edit my name**. The creator's signed-in email is added to each new group automatically, and they can add other participants by email when creating the group or under **Manage members**. Expense and balance screens show the person's chosen name when available, and their email otherwise. After signing in with the listed address, a participant sees the group in their normal group list without a shared URL. An unlisted address has no access to that group. Any listed member can add, change or remove member emails; removing an email revokes that person's access.

Other member emails are optional. A group with only its creator can track monthly spending or solo travel costs. Expenses in a one-member group have no repayment balance, and other members can be added later.

The **Share group** option has been removed. Add a member's email under **Manage members**; their group appears after they sign in. The app sends no invitation email. Previously issued links still work for listed members, but new links cannot be created in the app.

| Action | Creator | Listed email | Unlisted email |
| --- | --- | --- | --- |
| View expenses and balances | Yes | Yes | No |
| Add/edit/delete expenses; record/undo repayments | Yes | Yes | No |
| Manage participants and their access emails | Yes | Yes | No |
| Close/reopen/delete group | Yes | No | No |

Closed groups remain readable by listed members; only the creator can reopen them. A previously issued link shows only its linked group. **Go to my account** leaves link mode.

The creator-and-link migration removes the obsolete invitation RPCs and stops account memberships from granting access. Historical membership/invitation records are retained without client access, and group documents and existing edit links are preserved. Historical migrations remain in the repository so both new and existing databases can be upgraded safely.

## Storage and existing data

Groups are saved in Supabase and are not cached in localStorage. Google sessions persist in the browser, so sign out on shared browser profiles. Groups refresh on focus, every 30 seconds while visible and outside a dialog, or through **Refresh groups**. Version checks reject stale edits rather than overwrite someone else's work.

RLS protects ordinary table access. Dedicated database functions validate the edit key on every link read and write. Keys are stored in a private table and never included in group records. Clients cannot directly change ownership. Project administrators retain database access; this is not end-to-end encryption.

For older browser-only data, sign in on the same browser and app address and choose **Import browser groups**. You become the creator of the imported groups. IDs, expenses, splits and repayments are preserved; retries skip groups you already own. The original `gather-expenses-v2` localStorage backup remains untouched.

## Troubleshooting

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

Tests execute the SQL migrations in PGlite (embedded Postgres), including signed-in link access, member email access, profile name visibility, group isolation and stale writes. Adapter tests cover Google login, profile names and link RPCs. The browser suite uses a test-only cloud fixture and checks the name prompt, sign-in errors, group workflows, signed-in link edits and persistence. It does not test real Google OAuth or hosted Supabase; verify Google sign-in for creators and members on the deployed site. Set `CHROME_PATH` if needed or `TEST_URL` to use a running build. Fixtures are never deployed.

Amounts use integer paise. Splits support even, exact amounts, weighted shares and percentages. Repayments adjust balances without transferring money.
