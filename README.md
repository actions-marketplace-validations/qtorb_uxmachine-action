# UXMachine deploy check

Measures your published site after each deployment and compares it with the
previous measurement of the same site. It reports; it never fails your workflow.

## What it does
- Asks UXMachine to measure the address in a real browser, on desktop
  (1280×800) and mobile (390×844), on up to 11 pages of the site.
- Writes the report link to the job summary straight away.
- Waits up to 12 minutes and adds the comparison with the previous measurement:
  what is new, what is still observed, what came back, what is no longer
  observed and what could not be compared, with the reason.

"No longer observed" does not mean fixed. "Not compared" is not an improvement.

## What it does not do
- It never fails or blocks your workflow, whatever happens.
- It does not judge visual design, copy or brand, and gives no score.
- It does not prove that a measurement belongs to a given commit: it measures
  what the address served when its turn came. A cache or a later deployment
  can make it a different version.

## Setup
1. Create an Action key in your UXMachine panel (uxmachine.app/panel/canal).
2. Store it as a repository secret named UXMACHINE_KEY.
3. Add the workflow:

    on: deployment_status
    jobs:
      uxmachine:
        if: github.event.deployment_status.state == 'success'
        runs-on: ubuntu-latest
        steps:
          - uses: qtorb/uxmachine-action@v1
            with:
              clave: ${{ secrets.UXMACHINE_KEY }}
              url: https://www.example.com

Set url to your published address. The deployment URLs that hosting platforms
report change with every deployment, so they could not be compared with the
previous measurement.

This trigger works with platforms that report GitHub deployments, such as
Vercel. Netlify does not report them: run the Action in your own workflow,
after your deploy step.

## Cost and limits
Each measurement uses 1 credit of your UXMachine account, like any other
channel. Requests that are not measured use none. By default, a site is
measured at most once every 6 hours (minimo_entre_medidas_h).

## Privacy
We keep the repository and the commit or pull request that triggered the
measurement. We never store the key itself, only a fingerprint.
uxmachine.app/en/privacy
