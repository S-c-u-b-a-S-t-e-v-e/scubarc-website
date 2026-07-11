# Scuba Research Collective Website

Static HTML/CSS website deployed through Cloudflare Pages.

## Branches

- `main` — production website
- `site-v2` — development branch for the revised public-interest research site

## Local preview

```powershell
cd "D:\Demo-Room\Scuba_Stevez_Demo_Room\Projects\scubarc-website"
git switch site-v2
python -m http.server 8080
```

Open `http://127.0.0.1:8080/`.

## Publish workflow

```powershell
git status
git add .
git commit -m "Build ScubaRC site v2"
git push origin site-v2
```

Review locally before opening a pull request from `site-v2` into `main`.

## Public navigation

Home, Mission, Research, Public Benefit, Foundation, Governance, and Contact.

`depthbot.html` and `hamilton.html` are retained as hidden incubating pages with
`noindex, nofollow` and are intentionally excluded from public navigation.
