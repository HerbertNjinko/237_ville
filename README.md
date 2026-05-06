# 237 Ville Community Platform

237 Ville is a Node/Postgres web application for member communication, voting, events, dues, donations, member questions, and admin publishing.

## Features

- Member registration and email-based login.
- Automatic default admin bootstrap from `.env` on migration/server start.
- Forced password update for the default admin and approved members with temporary passwords.
- Admin approval workflow for new registrations.
- Member onboarding with policy acknowledgement and registration fee review.
- Member profiles with contact details and notification preferences.
- Announcements and articles published by admins.
- In-app notifications when announcements are published.
- Event calendar entries managed by admins.
- Member questions with admin approval before public discussion.
- Public comments on published member questions.
- Issue votes and executive board elections with aggregate results only in the UI.
- Dues and donation records for members, with admin payment review.
- Admin tools for members, announcements, events, questions, ballots, and payments.

## Local setup

1. Create the Postgres database if it does not already exist:

   ```bash
   createdb organization_237
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Run the schema migration:

   ```bash
   npm run migrate
   ```

5. Optionally seed or refresh the default admin account:

   ```bash
   npm run seed
   ```

   The server also checks this admin account at startup. Default login:

   - Email: `admin@237ville.org`
   - Password: `ChangeMe237!`

6. Start the app:

   ```bash
   npm start
   ```

   Then open `http://localhost:4173`.

## Voting privacy note

The database stores a voter identifier so each member can vote only once per ballot. The member-facing and admin-facing UI intentionally shows only aggregate vote totals and never lists which member voted for a candidate or issue option.

## Payments note

The app currently records dues, donations, and registration fee payment records for admin review. A payment processor such as Stripe, PayPal, or a local mobile money provider can be added later for live card or mobile payments.

## Member onboarding flow

1. A visitor registers with first name, last name, and email only.
2. Admins receive an in-app notification and approve the account with a temporary password.
3. The member logs in with the temporary password and must set a private password.
4. The member signs the organization policy.
5. The member submits a registration fee record.
6. An admin marks the registration fee received, which activates the member portal account.
