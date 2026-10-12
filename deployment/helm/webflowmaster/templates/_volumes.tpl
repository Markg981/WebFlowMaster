{{/*
The artifact volumes, mounted by the api and the worker alike (docker-compose.yml mounts the
same two). Nothing is mounted with the S3 store; with persistence off, emptyDir keeps a
single-replica evaluation working but loses the evidence with the pod.
*/}}
{{- define "webflowmaster.artifactVolumes" -}}
{{- if eq .Values.artifacts.store "local" }}
- name: results
  {{- if .Values.artifacts.persistence.enabled }}
  persistentVolumeClaim:
    claimName: {{ default (printf "%s-results" (include "webflowmaster.fullname" .)) .Values.artifacts.persistence.results.existingClaim }}
  {{- else }}
  emptyDir: {}
  {{- end }}
- name: baselines
  {{- if .Values.artifacts.persistence.enabled }}
  persistentVolumeClaim:
    claimName: {{ default (printf "%s-baselines" (include "webflowmaster.fullname" .)) .Values.artifacts.persistence.baselines.existingClaim }}
  {{- else }}
  emptyDir: {}
  {{- end }}
{{- end }}
{{- end -}}

{{- define "webflowmaster.artifactVolumeMounts" -}}
{{- if eq .Values.artifacts.store "local" }}
- name: results
  mountPath: /app/results
- name: baselines
  mountPath: /app/data/visual-baselines
{{- end }}
{{- end -}}
