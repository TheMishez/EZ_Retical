# Code signing (free, through SignPath Foundation)

Unsigned installers make Windows SmartScreen say "Windows protected your PC". SignPath Foundation signs open-source projects for free with a certificate in its own name, and the GitHub workflow here is already wired for it: once the secret below exists, every release is signed automatically. Until then, releases build exactly as before, just unsigned.

## 1. Before you apply
- The repo must be **public** and have an **open-source license** (an OSI-approved one, such as MIT) in a `LICENSE` file.
- Releases must be built by GitHub Actions (they are: `.github/workflows/release.yml`).
- Add a short "Code signing policy" note to the README (SignPath gives you the exact wording when you're accepted).

## 2. Apply
Apply at https://signpath.org/apply with the repo link `https://github.com/TheMishez/EZ_Retical`. Review takes a few days to a few weeks.

## 3. Once you're accepted
In SignPath:
1. Create a project with the slug **`EZ_Retical`** and link it to this GitHub repo as a trusted build system.
2. Add two artifact configurations, pasting in the files from this folder:
   - slug **`app`** ← `docs/signing/app.xml`
   - slug **`installer`** ← `docs/signing/installer.xml`
3. Use the signing policy slug **`release-signing`** (that is the Foundation's default).
4. Create an API token for a CI user that is allowed to submit to that policy.

In GitHub, open the repo's **Settings → Secrets and variables → Actions**:
- **Secrets** tab: add `SIGNPATH_API_TOKEN` = the API token.
- **Variables** tab: add `SIGNPATH_ORGANIZATION_ID` = your SignPath organization ID.
  (Only add `SIGNPATH_PROJECT_SLUG` / `SIGNPATH_POLICY_SLUG` if you used different slugs.)

That's it. The next release you publish is signed: first the `EZ Reticle.exe` inside, then the `EZ-Reticle-Setup-x.y.z.exe` installer, and `latest.yml` is corrected so in-app updates still verify.
