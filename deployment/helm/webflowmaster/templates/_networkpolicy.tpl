{{/*
Egress rules both the api and the worker need: cluster DNS, PostgreSQL and Redis (the chart's
own pods, or the CIDR blocks in networkPolicy.databaseEgress), and the applications under test
and notification endpoints (networkPolicy.egressCidrs).
*/}}
{{- define "webflowmaster.commonEgress" -}}
- to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          k8s-app: kube-dns
  ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
{{- if .Values.postgresql.enabled }}
- to:
    - podSelector:
        matchLabels:
          {{- include "webflowmaster.selectorLabels" . | nindent 10 }}
          app.kubernetes.io/component: postgresql
  ports:
    - protocol: TCP
      port: 5432
{{- end }}
{{- if .Values.redis.enabled }}
- to:
    - podSelector:
        matchLabels:
          {{- include "webflowmaster.selectorLabels" . | nindent 10 }}
          app.kubernetes.io/component: redis
  ports:
    - protocol: TCP
      port: 6379
{{- end }}
{{- range .Values.networkPolicy.databaseEgress }}
- to:
    - ipBlock:
        cidr: {{ .cidr }}
  ports:
    - protocol: TCP
      port: {{ .port }}
{{- end }}
{{- range .Values.networkPolicy.egressCidrs }}
- to:
    - ipBlock:
        cidr: {{ .cidr }}
        {{- with .except }}
        except:
          {{- toYaml . | nindent 10 }}
        {{- end }}
{{- end }}
{{- end -}}
