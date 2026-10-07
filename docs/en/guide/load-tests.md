# Load tests

The [performance check](./api-tests#performance) of an API test repeats one request inside a
functional run: at most 200 requests, 10 at a time, the same values every time. It answers "did
this endpoint get slower?". A **load test** answers a different question: how does the system
behave when many users go through a flow at once, for minutes, with the load growing?

Open **Load tests** in the navigation. A load test repeats API tests you have already saved in the
[API Tester](./api-tests); it never runs as part of a plan.

## The scenario

A load test is a sequence of saved API tests — sign in, add to the cart, check out — that each
**virtual user** runs in order, again and again. One pass through the sequence is an
**iteration**.

- What a test [captures](./api-tests#captures) is sent by the next tests of the same iteration,
  as in a plan: the token from the sign-in goes into the cart request.
- A test fails when its request cannot be made or one of its assertions does not hold. A failed
  test ends the iteration — the next tests would send what it did not capture — and the user
  starts the next one.
- **Pause after (ms)** waits after a test, as a person reading the page would. Up to 60 s.

Up to 20 API tests per scenario. Each test is sent with its own method, URL, headers, body,
authentication, assertions and captures, exactly as in a plan.

## The load profile

The number of virtual users follows **stages**. Each stage moves it linearly from where the
previous stage ended (0 at the start) to its **virtual users** target, over its **duration**:

| Stage | Duration | Virtual users | What happens                |
| ----- | -------- | ------------- | --------------------------- |
| 1     | 60 s     | 50            | ramp up from 0 to 50        |
| 2     | 600 s    | 50            | hold 50 users for 10 minutes |
| 3     | 60 s     | 0             | ramp down to 0              |

Up to 10 stages, 200 virtual users and 3,600 s in all. A user above the current target stops
at the end of its iteration, so a ramp down never cuts a scenario in half. The editor draws the
profile as you change it.

**Warm-up (s)** is the start of the run that is sent but not judged: caches, JIT compilers and
connection pools fill up there. Its requests are counted apart and shaded on the timeline. The
warm-up must end before the last stage does.

## Data per virtual user

Without a data set every virtual user sends the same values. Choose one of the organization's
[test data](./organizing#test-data) sets, and `{{data.<set>.<column>}}` in the API tests becomes
each user's own row:

- **A row of its own for each virtual user** — user 1 reads row 1, user 2 row 2, and so on. The
  set needs at least as many rows as virtual users at the peak, so no two users share an account;
  saving or starting a test with fewer rows is refused and says how many are missing.
- **The next row on every iteration** — every iteration, of any user, takes the next row,
  starting over at the end. Any number of rows will do.

`{{load.vu}}` (1, 2, …) and `{{load.iteration}}` (1, 2, … for each user) are always available,
for example to make an order reference unique: `order-{{load.vu}}-{{load.iteration}}`.

## Thresholds and verdict

Each threshold is optional and judged on the requests sent after the warm-up:

- **Median (p50)**, **95th percentile (p95)**, **99th percentile (p99)** and **Slowest**, in ms;
- **Failed requests**, in percent;
- **Minimum throughput**, in requests per second over the judged time.

A run **passes** when it reaches the end within every threshold and **fails** naming each
threshold exceeded ("p95 412 ms > 300 ms", "throughput 38 req/s < 50 req/s"). A run that judged
no request fails too. **Cancelled** means someone stopped it; **Could not run** means it never got
going — an API test or the data set was deleted, the data set has too few rows — or the server
running it stopped.

## Running and following a run

Open the **runs** of a load test, choose an environment (its variables and secrets resolve the
`{{placeholders}}` as in a plan), and **Start a run**. The page follows it while it runs, every
2 seconds:

- progress, virtual users now and at the peak;
- the timeline: virtual users, requests per second and p95 over time, with the warm-up shaded;
- for each API test and for all requests: requests, errors, p50, p90, p95, p99 and slowest;
- iterations completed and failed, and the first distinct errors.

**Stop the run** ends it within 2 seconds; requests already in flight finish. Each load test keeps
its last 10 runs on the page, with their summary and verdict.

### Where a run runs

A load run is sent **from the WebFlowMaster server**, apart from plans, runners and agents: it
does not take a runner slot, and a plan does not slow it down. Because the load comes from the
server's network, test from where the server can reach the system under test.

- One load run at a time per organization: two would measure each other.
- At most two load runs per server process, all organizations together; a third gets a "try again
  when one ends" answer.
- A run counts towards the organization's [execution minutes](../admin/administration#quotas) like an API test.
- If the server stops during a run, the run is closed as **Could not run** about a minute later.

Percentiles come from a uniform sample of at most 10,000 durations per test, so they are estimates
above that; counts, errors, minimum, mean and maximum are exact. The timeline has at most 240
points.

## Permissions

Viewers see load tests and their runs. Editors create, change, run, stop and delete them. A load
test in a restricted project belongs to the project, like its API tests.
