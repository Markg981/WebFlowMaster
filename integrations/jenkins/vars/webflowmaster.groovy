/**
 * WebFlowMaster for Jenkins, as a shared library step.
 *
 * Add this repository's integrations/jenkins directory as a Global Pipeline Library
 * (Manage Jenkins → System → Global Pipeline Libraries, name "webflowmaster"), then:
 *
 *   @Library('webflowmaster') _
 *   pipeline {
 *     agent { docker { image 'node:20' } }
 *     stages {
 *       stage('E2E') {
 *         steps { webflowmaster plan: 'your-plan-id', url: 'https://webflowmaster.example.com' }
 *       }
 *     }
 *   }
 *
 * The API key is a Jenkins "Secret text" credential, 'webflowmaster-api-key' unless named. The
 * CLI is downloaded from the server it will talk to, so it always matches it. The run is linked
 * to this build, commit and change request automatically. The agent needs Node 18 or later.
 *
 * Returns the CLI's exit code: 0 passed, 1 the run failed, 2 the step could not be carried out.
 */
def call(Map args = [:]) {
  String plan = args.plan ?: error('webflowmaster: "plan" is required')
  String url = args.url ?: env.WFM_URL ?: error('webflowmaster: pass "url" or set WFM_URL')
  String credentialsId = args.credentialsId ?: 'webflowmaster-api-key'
  String junitFile = args.containsKey('junit') ? args.junit : 'webflowmaster-junit.xml'
  String htmlFile = args.containsKey('html') ? args.html : 'webflowmaster-report.html'
  // 'fail' fails the build on a failed run; 'unstable' marks it unstable and carries on.
  String onFailure = args.onFailure ?: 'fail'

  int code
  withCredentials([string(credentialsId: credentialsId, variable: 'WFM_API_KEY')]) {
    withEnv([
      "WFM_URL=${url}",
      "WFM_PLAN=${plan}",
      "WFM_ENVIRONMENT=${args.environment ?: ''}",
      "WFM_TIMEOUT=${args.timeout ?: 1800}",
      "WFM_JUNIT=${junitFile ?: ''}",
      "WFM_HTML=${htmlFile ?: ''}",
    ]) {
      // Single-quoted: the shell expands the variables, Groovy interpolates nothing into it.
      code = sh(returnStatus: true, script: '''
        set -u
        node -e "fetch(process.env.WFM_URL.replace(/\\/+$/, '') + '/cli/wfm.mjs')
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then((t) => require('fs').writeFileSync('wfm.mjs', t))
          .catch((e) => { console.error('Could not download the WebFlowMaster CLI: ' + e.message); process.exit(2); })" || exit 2
        set -- run "$WFM_PLAN" --wait --timeout "$WFM_TIMEOUT"
        [ -n "$WFM_ENVIRONMENT" ] && set -- "$@" --environment "$WFM_ENVIRONMENT"
        [ -n "$WFM_JUNIT" ] && set -- "$@" --junit "$WFM_JUNIT"
        [ -n "$WFM_HTML" ] && set -- "$@" --html "$WFM_HTML"
        node wfm.mjs "$@"
      ''')
    }
  }

  // Published whatever the verdict: a failed run is when they are read.
  if (junitFile && fileExists(junitFile)) junit testResults: junitFile, allowEmptyResults: true
  if (htmlFile && fileExists(htmlFile)) archiveArtifacts artifacts: htmlFile, allowEmptyArchive: true

  if (code == 2) error('WebFlowMaster: the run could not be started or followed; see the log above.')
  if (code == 1) {
    if (onFailure == 'unstable') unstable('WebFlowMaster: the test plan failed.')
    else error('WebFlowMaster: the test plan failed.')
  }
  return code
}
