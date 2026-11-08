#!/usr/bin/env python3
"""
D-LAB-5 template — the demo driver.

    python3 scripts/demo.py        (or: npm run demo)

A menu over the two things that are awkward the first time: deploying a
sandbox, and getting a user you can actually sign in as. It checks the
environment first and says what to fix rather than failing halfway through a
five-minute deploy.

Deliberately dependency-free — standard library plus the `aws` CLI, which this
workflow already requires. boto3 is NOT assumed: it is absent on a stock
Ubuntu, and a demo script that opens with `pip install` is not a demo.

Nothing here is used by the app. Deleting this file costs you the convenience
and nothing else.
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
SITE = ROOT / "packages" / "site"
OUTPUTS = BACKEND / "amplify_outputs.json"
SITE_OUTPUTS = SITE / "src" / "amplify_outputs.json"

# -- the demo account --------------------------------------------------------
#
# Both of these differ slightly from "demo-user / demo-user$1", and both for a
# reason Cognito enforces rather than a preference:
#
#   The USERNAME must be an email. auth/resource.ts uses `loginWith: { email }`,
#   which makes email the pool's username attribute — Cognito then rejects any
#   username that is not one. example.com is reserved by RFC 2606 precisely for
#   this, and the invitation mail is suppressed anyway.
#
#   The PASSWORD needs an uppercase letter. defineAuth sets no password policy,
#   so Cognito's own default applies: at least 8 characters with an uppercase,
#   a lowercase, a number and a symbol. "demo-user$1" has every one of those
#   except the uppercase, so the capital D is the whole difference.
#
# Relaxing the pool's policy to fit the password would have been the other way
# to solve it, and it would weaken the template permanently to save one
# keystroke in a demo.
DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "demo-user@example.com")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "Demo-user$1")
ADMIN_GROUP = "app-admins"

# -- output ------------------------------------------------------------------

TTY = sys.stdout.isatty()

# Line-buffer our own output.
#
# Python block-buffers stdout when it is not a terminal, so piping this into a
# log or a pager holds every print() until the buffer fills — while the ampx
# and gatsby subprocesses, which own the fd directly, stream out normally. The
# result is a log that shows a deploy finishing and then appears to stop, with
# the demo account never mentioned even though it was created. Observed doing
# exactly that, which is the only reason this line is here.
try:
    sys.stdout.reconfigure(line_buffering=True)
except AttributeError:  # pragma: no cover - Python < 3.7
    pass


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if TTY else text


bold = lambda t: _c("1", t)
dim = lambda t: _c("2", t)
cyan = lambda t: _c("1;36", t)
green = lambda t: _c("32", t)
yellow = lambda t: _c("33", t)
red = lambda t: _c("31", t)


def title(text: str) -> None:
    print(f"\n{cyan('▸ ' + text)}")


def para(text: str) -> None:
    """Explanations are indented and wrapped by hand so they stay scannable."""
    for line in text.strip("\n").split("\n"):
        print(f"  {line}")


# -- running things ----------------------------------------------------------


def run(cmd, cwd=None, capture=True, check=False):
    """A thin wrapper so every subprocess call looks the same at the call site."""
    return subprocess.run(
        cmd,
        cwd=cwd,
        check=check,
        text=True,
        capture_output=capture,
    )


def aws(args, profile=None, region=None):
    cmd = ["aws"] + args
    if profile:
        cmd += ["--profile", profile]
    if region:
        cmd += ["--region", region]
    return run(cmd)


# -- checks ------------------------------------------------------------------
#
# Each returns (status, detail, fix). `fix` is printed only when it is not ok,
# because a checklist where every line carries advice is one nobody reads.

OK, WARN, FAIL = "ok", "warn", "fail"


def check_node():
    exe = shutil.which("node")
    if not exe:
        return FAIL, "not found", "Install Node 22:  nvm install 22 && nvm use"
    v = run([exe, "-v"]).stdout.strip()
    major = int(re.sub(r"^v(\d+).*", r"\1", v))
    if major < 22:
        return FAIL, v, "Node 22 is required (.nvmrc):  nvm use"
    return OK, v, None


def check_deps():
    missing = [
        str(p.relative_to(ROOT))
        for p in (ROOT / "node_modules", BACKEND / "node_modules")
        if not p.is_dir()
    ]
    if missing:
        return (
            FAIL,
            "missing " + ", ".join(missing),
            "npm install && npm --prefix backend install\n"
            "  (two installs — the backend is deliberately not a workspace, ADR-0001)",
        )
    return OK, "installed", None


def check_aws_cli():
    if not shutil.which("aws"):
        return (
            FAIL,
            "not found",
            "Install the AWS CLI. On Ubuntu:  sudo snap install aws-cli --classic",
        )
    return OK, "present", None


def check_aws_identity(profile):
    """The 'is the AWS environment set up at all' check.

    This is the one that actually stops people. Everything below it in the
    menu needs credentials, and the failure modes — no config, expired SSO,
    wrong profile, no region — all look the same from inside a deploy that
    dies four minutes in.
    """
    if not shutil.which("aws"):
        return FAIL, "no aws CLI", None

    r = aws(["sts", "get-caller-identity", "--output", "json"], profile=profile)
    if r.returncode != 0:
        err = (r.stderr or "").strip()
        hint = (
            "No AWS credentials resolved"
            + (f" for profile '{profile}'" if profile else "")
            + ".\n"
            "  Set one up, then re-run:\n"
            "    aws configure --profile <name>       long-lived keys, or\n"
            "    aws sso login --profile <name>       short-lived (preferred)\n"
            "    export AWS_PROFILE=<name>\n"
            "  Then:  python3 scripts/demo.py --profile <name>"
        )
        if "ExpiredToken" in err or "expired" in err.lower():
            hint = (
                "Your credentials have expired.\n"
                f"    aws sso login{' --profile ' + profile if profile else ''}"
            )
        return FAIL, "no credentials", hint

    account = json.loads(r.stdout)["Account"]

    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or (aws(["configure", "get", "region"], profile=profile).stdout or "").strip()
    )
    if not region:
        return (
            FAIL,
            f"{account}, no region",
            "ampx cannot deploy without a region:\n"
            f"    aws configure set region eu-central-1"
            + (f" --profile {profile}" if profile else ""),
        )

    who = f"{account}  {region}  profile={profile or os.environ.get('AWS_PROFILE', 'default')}"
    return OK, who, None


def check_inotify():
    """Constraint 10. Gatsby dies with ENOSPC and blames nothing."""
    try:
        watches = int(Path("/proc/sys/fs/inotify/max_user_watches").read_text())
        instances = int(Path("/proc/sys/fs/inotify/max_user_instances").read_text())
    except (OSError, ValueError):
        return OK, "n/a", None
    if watches < 524288 or instances < 1024:
        return (
            WARN,
            f"{watches} / {instances}",
            "Gatsby will likely die with ENOSPC. Raise them:\n"
            "    sudo sysctl -w fs.inotify.max_user_watches=524288 "
            "fs.inotify.max_user_instances=1024",
        )
    return OK, f"{watches} / {instances}", None


# -- sandbox state -----------------------------------------------------------
#
# Three states, not two. "Outputs on disk" is not the same as "a sandbox
# exists": deleting the sandbox leaves the file behind, and a file naming a
# user pool that no longer exists is what makes sign-in fail with a stack
# trace instead of a sentence.

NONE, LIVE, STALE, UNKNOWN = "none", "live", "stale", "unknown"


def demo_user_exists(profile):
    """Whether the demo account is actually in the pool.

    Asked rather than assumed: a sandbox can be deployed by `npm run dev` or
    `ampx sandbox` directly, neither of which creates it. Printing credentials
    for an account that is not there would send someone to debug a password
    that was never set.
    """
    try:
        pool = json.loads(OUTPUTS.read_text())["auth"]["user_pool_id"]
    except (json.JSONDecodeError, KeyError, OSError):
        return False
    r = aws(["cognito-idp", "admin-get-user", "--user-pool-id", pool,
             "--username", DEMO_EMAIL], profile=profile)
    return r.returncode == 0


def sandbox_state(profile, have_creds):
    if not OUTPUTS.is_file():
        return NONE, None
    try:
        pool = json.loads(OUTPUTS.read_text())["auth"]["user_pool_id"]
    except (json.JSONDecodeError, KeyError, OSError):
        return STALE, None
    if not have_creds:
        return UNKNOWN, pool
    r = aws(["cognito-idp", "describe-user-pool", "--user-pool-id", pool], profile=profile)
    return (LIVE, pool) if r.returncode == 0 else (STALE, pool)


# -- actions -----------------------------------------------------------------


def deploy(profile):
    title("Deploying the sandbox")
    para(
        "First deploy takes a few minutes: CloudFormation is creating a Cognito\n"
        "pool, an AppSync API, DynamoDB tables, an S3 bucket and a Lambda.\n"
        "Later deploys are seconds."
    )
    print()
    cmd = ["npx", "ampx", "sandbox", "--once"]
    if profile:
        cmd += ["--profile", profile]
    if subprocess.run(cmd, cwd=BACKEND).returncode != 0:
        print(red("\n  Deploy failed. The output above is ampx's own."))
        return False
    if OUTPUTS.is_file():
        shutil.copy(OUTPUTS, SITE_OUTPUTS)
        print(green(f"\n  outputs → {SITE_OUTPUTS.relative_to(ROOT)}"))
    return True


def ensure_demo_user(profile):
    """Create the demo account, or reset it if it is already there.

    `--message-action SUPPRESS` matters: without it Cognito emails the
    temporary password to demo-user@example.com, which is a reserved domain
    nobody receives. `--permanent` on the password matters too — it skips the
    new-password challenge that AuthGate handles, which is correct for a real
    first login and pure friction in a demo.
    """
    title("Demo account")
    try:
        pool = json.loads(OUTPUTS.read_text())["auth"]["user_pool_id"]
    except (json.JSONDecodeError, KeyError, OSError):
        print(red("  No usable amplify_outputs.json — deploy first."))
        return False

    base = ["cognito-idp", "admin-create-user", "--user-pool-id", pool,
            "--username", DEMO_EMAIL,
            "--user-attributes", f"Name=email,Value={DEMO_EMAIL}",
            "Name=email_verified,Value=true",
            "--message-action", "SUPPRESS"]
    r = aws(base, profile=profile)
    if r.returncode != 0 and "UsernameExistsException" not in (r.stderr or ""):
        print(red(f"  Could not create the user:\n  {(r.stderr or '').strip()}"))
        return False
    existed = r.returncode != 0

    r = aws(["cognito-idp", "admin-set-user-password", "--user-pool-id", pool,
             "--username", DEMO_EMAIL, "--password", DEMO_PASSWORD, "--permanent"],
            profile=profile)
    if r.returncode != 0:
        err = (r.stderr or "").strip()
        print(red(f"  Could not set the password:\n  {err}"))
        if "InvalidPasswordException" in err:
            pol = aws(["cognito-idp", "describe-user-pool", "--user-pool-id", pool,
                       "--query", "UserPool.Policies.PasswordPolicy"], profile=profile)
            print(yellow("\n  This pool's actual password policy:"))
            para(pol.stdout.strip())
            para("Set DEMO_PASSWORD to something that satisfies it and re-run.")
        return False

    r = aws(["cognito-idp", "admin-add-user-to-group", "--user-pool-id", pool,
             "--username", DEMO_EMAIL, "--group-name", ADMIN_GROUP], profile=profile)
    if r.returncode != 0:
        print(yellow(f"  Could not add to {ADMIN_GROUP}: {(r.stderr or '').strip()}"))

    print(green(f"  {'reset' if existed else 'created'} and added to {ADMIN_GROUP}"))
    print(f"\n    email     {bold(DEMO_EMAIL)}")
    print(f"    password  {bold(DEMO_PASSWORD)}\n")
    para(
        dim(
            "An operator (app-admins). On first sign-in it must set up two-step\n"
            "sign-in (an authenticator app); then Settings → Operator creates a\n"
            "tenant with this account as its first admin, and its shared space."
        )
    )
    return True


def sign_in_card():
    """Everything needed to get in, printed where it is last on screen.

    Repeated here even though ensure_demo_user() already said it, because
    between the two there is a Gatsby build: several hundred lines of webpack
    output that push the credentials off the terminal. The one moment you need
    them is the moment they have just scrolled away.
    """
    print()
    print(f"  {bold('Open')}      http://localhost:8000")
    print(f"  {bold('Email')}     {DEMO_EMAIL}")
    print(f"  {bold('Password')}  {DEMO_PASSWORD}")
    print()
    para(
        dim(
            "The password is case-sensitive and starts with a capital D. The\n"
            "field has an eye to reveal what you typed — a wrong character and\n"
            "a wrong account give the same error, so it is worth a look before\n"
            "assuming the credentials are wrong."
        )
    )


def port_in_use(port=8000):
    """Is something already serving there?

    Gatsby's own message for this is easy to miss in its startup banner, and
    the usual cause is an earlier dev server from this same script that was
    never stopped — at which point you are looking at a stale page and
    wondering why an edit did nothing.
    """
    import socket

    with socket.socket() as sock:
        sock.settimeout(0.4)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def start_dev():
    if port_in_use():
        title("Port 8000 is already in use")
        para(
            "Something is serving there already — most likely a dev server from\n"
            "an earlier run of this script. Gatsby will either refuse to start or\n"
            "quietly pick another port, and you would be reading a stale page.\n"
            "\n"
            "Find and stop it, then try again:\n"
            "    ss -ltnp | grep :8000\n"
            "    pkill -f 'gatsby develop'"
        )
        print()
        para(dim("Or just open the one already running:"))
        sign_in_card()
        return

    title("Starting Gatsby")
    sign_in_card()
    print()
    para(dim("Ctrl-C stops the dev server. The sandbox stays deployed."))
    print()
    try:
        subprocess.run(["npx", "gatsby", "develop", "-H", "0.0.0.0"], cwd=SITE)
    except KeyboardInterrupt:
        pass
    # And again on the way out: by now the credentials are thousands of lines
    # up, and the usual reason for stopping the server is to start it again.
    print()
    title("Dev server stopped")
    sign_in_card()
    para(dim("Restart it with option 3. The sandbox is untouched."))


def delete_sandbox(profile):
    title("Deleting the sandbox")
    para(
        "This destroys the Cognito pool, the S3 bucket and its contents, the\n"
        "DynamoDB tables and the Lambda. It is not recoverable."
    )
    if input(f"\n  Type {bold('delete')} to confirm: ").strip().lower() != "delete":
        print(dim("  Cancelled."))
        return
    cmd = ["npx", "ampx", "sandbox", "delete", "--yes"]
    if profile:
        cmd += ["--profile", profile]
    if subprocess.run(cmd, cwd=BACKEND).returncode != 0:
        print(red("  Delete failed — see the output above."))
        return
    for f in (OUTPUTS, SITE_OUTPUTS):
        f.unlink(missing_ok=True)
    shutil.rmtree(BACKEND / ".amplify", ignore_errors=True)
    print(green("\n  Deleted, and the stale outputs removed with it."))


# -- menu --------------------------------------------------------------------


def banner():
    print(bold("\n  D-LAB-5 template — demo"))
    print(dim("  a sandbox, a user you can sign in as, and the dev server"))


def environment(profile):
    title("Environment")
    results = [
        ("node", check_node()),
        ("dependencies", check_deps()),
        ("aws cli", check_aws_cli()),
        ("aws account", check_aws_identity(profile)),
        ("inotify", check_inotify()),
    ]
    mark = {OK: green("ok  "), WARN: yellow("warn"), FAIL: red("fail")}
    for label, (status, detail, _) in results:
        print(f"  {mark[status]}  {label:<14} {detail}")
    for label, (status, _, fix) in results:
        if status != OK and fix:
            print(f"\n  {yellow(label)}:")
            para(fix)
    return {label: status for label, (status, _, _) in results}


def explain(state, pool, have_demo_user=False):
    title("What you are about to create" if state == NONE else "Current state")
    if state == NONE:
        para(
            "A SANDBOX is your own private copy of the whole backend, deployed to\n"
            "your AWS account. It is not shared and not simulated — real Cognito,\n"
            "real DynamoDB, real S3. It costs a little and it outlives this\n"
            "terminal, so delete it when you are done.\n"
            "\n"
            "Which account? Whatever your shell already points at — see the line\n"
            "above. Nothing in this repo names an account; that is deliberate.\n"
            "\n"
            "The stack is named after your system username, so two people on the\n"
            "same account never collide."
        )
    elif state == LIVE:
        para(f"A sandbox is deployed and reachable.  {dim('pool ' + str(pool))}")
        if have_demo_user:
            sign_in_card()
        else:
            print()
            para(
                yellow("There is no demo account in this pool yet.")
                + "\n"
                + f"Option 1 creates {DEMO_EMAIL} and puts it in {ADMIN_GROUP}.\n"
                + "It redeploys first, which is quick when nothing changed."
            )
    elif state == STALE:
        para(
            "amplify_outputs.json is on disk but the user pool it names does not\n"
            f"exist — {dim(str(pool))}\n"
            "\n"
            "The sandbox was deleted and the file was left behind. Until one of\n"
            "these is done, signing in fails against a pool that is not there:\n"
            "\n"
            "  option 1  deploy again — overwrites the file\n"
            "  option 2  clear the stale file, and any stack remnants with it"
        )
    else:
        para("Outputs exist, but without credentials I cannot tell if the sandbox does.")


def menu(state):
    """Options that cannot work are shown, dimmed, and refuse with a reason.

    Hiding them would be tidier and worse: the reader would not learn that
    deleting is a thing, and would wonder what happened to option 2.
    """
    can_delete = state in (LIVE, STALE, UNKNOWN)
    can_dev = state in (LIVE, UNKNOWN)

    verb = "Create sandbox" if state in (NONE, STALE) else "Update sandbox"
    print()
    print(f"  {bold('1')}  {verb}"
          f"{dim('  — deploy, make the demo user, start the dev server')}")
    print(
        f"  {bold('2')}  Delete sandbox"
        if can_delete
        else dim("  2  Delete sandbox           (no sandbox to delete)")
    )
    print(
        f"  {bold('3')}  Start dev server only"
        if can_dev
        else dim("  3  Start dev server only    (deploy one first)")
    )
    print(f"  {bold('0')}  Exit\n")
    return can_delete, can_dev


def main():
    profile = None
    argv = sys.argv[1:]
    if "--profile" in argv:
        profile = argv[argv.index("--profile") + 1]

    banner()

    # The environment survey and the explanation are printed on entry and
    # after anything that could have changed them — not on every keystroke.
    # Repainting the whole screen because someone pressed 9 buries the one
    # line they needed to read, and each repaint costs two AWS round trips.
    stale_view = True
    status = {}
    state, pool, have_creds = NONE, None, False

    while True:
        if stale_view:
            status = environment(profile)
            have_creds = status.get("aws account") == OK
            state, pool = sandbox_state(profile, have_creds)
            have_demo_user = have_creds and state == LIVE and demo_user_exists(profile)
            explain(state, pool, have_demo_user)
            stale_view = False

        can_delete, can_dev = menu(state)

        try:
            choice = input("  > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0

        if choice == "0":
            print(dim("  Bye.\n"))
            return 0

        if choice == "1":
            if not have_creds:
                print(red("\n  Needs AWS credentials — see the fix above.\n"))
                continue
            if status.get("dependencies") == FAIL:
                print(red("\n  Install dependencies first.\n"))
                continue
            if deploy(profile) and ensure_demo_user(profile):
                start_dev()
            stale_view = True
            continue

        if choice == "2":
            if not can_delete:
                print(dim("\n  There is no sandbox to delete.\n"))
                continue
            if not have_creds:
                print(red("\n  Needs AWS credentials — see the fix above.\n"))
                continue
            delete_sandbox(profile)
            stale_view = True
            continue

        if choice == "3":
            if not can_dev:
                print(dim("\n  Deploy a sandbox first (option 1).\n"))
                continue
            if OUTPUTS.is_file():
                shutil.copy(OUTPUTS, SITE_OUTPUTS)
            start_dev()
            continue

        print(dim("  Pick 1, 2, 3 or 0."))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print()
        sys.exit(130)
