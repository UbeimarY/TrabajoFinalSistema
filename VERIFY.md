# Zero Trust Verification Guide
## Plataforma de Votación — Pruebas de Seguridad

Este documento describe el conjunto de pruebas que demuestran que el sistema
cumple los tres pilares Zero Trust del enunciado:

1. **Red (nftables)** — default-deny, solo el tráfico estrictamente necesario.
2. **Aplicación (JWT)** — Kafka y RabbitMQ rechazan conexiones sin token válido.
3. **Identidad (auth_server)** — cada servicio tiene su propia identidad.

---

## Prerrequisitos

```bash
# Desde tu máquina local con el inventory.ini completado:
export VM_AUTH=<IP pública vm-auth>
export VM_API=<IP pública vm-api>
export VM_BROKERS=<IP privada vm-brokers>   # solo accesible internamente
```

---

## Bloque A — Verificación de Red (nftables)

### A1. vm-api acepta tráfico HTTP/HTTPS desde Internet
```bash
# Debe responder 200
curl -sk https://$VM_API/health
# Resultado esperado: {"ok":true}
```

### A2. vm-auth acepta solo las VMs autorizadas — rechaza conexiones externas
```bash
# Desde tu máquina (no está en la lista blanca) debe TIMEOUT/REFUSED
curl -sk --connect-timeout 3 https://$VM_AUTH/health
# Resultado esperado: curl: (28) Connection timed out  ← nftables bloqueó
```

### A3. vm-brokers no es alcanzable desde Internet
```bash
# Kafka puerto 9092 — debe TIMEOUT
nc -zv -w 3 $VM_AUTH 9092 2>&1 | grep -E "(refused|timed out)"
# RabbitMQ puerto 5672 — debe TIMEOUT
nc -zv -w 3 $VM_AUTH 5672 2>&1 | grep -E "(refused|timed out)"
```

### A4. Verificar reglas activas en cada VM con Ansible
```bash
ansible all -i inventory.ini -b -a "nft list ruleset" \
  | grep -E "(policy drop|accept|dport)"
# Cada VM debe mostrar:  policy drop;  en input, output y forward.
```

### A5. Tráfico lateral bloqueado (vm-app NO puede hablar con vm-init)
```bash
# SSH a vm-app y probar alcance a vm-init (solo vm-brokers debe ser alcanzable)
ansible vm_app -i inventory.ini -b -a \
  "docker run --rm --network host alpine nc -zv -w 2 {{ hostvars['vm-init'].private_ip }} 9092"
# Resultado esperado: nc: connect to ... timed out
```

---

## Bloque B — Verificación JWT en Kafka (SASL/OAUTHBEARER)

### B1. Conexión anónima a Kafka es rechazada
```bash
# SSH a vm-core (tiene acceso de red a vm-brokers:9092)
ansible vm_core -i inventory.ini -b -a \
  "docker run --rm --network host \
     -v /opt/zero-trust/certs:/certs:ro \
     confluentinc/cp-kafka:7.6.0 \
     kafka-console-producer --bootstrap-server {{ hostvars['vm-brokers'].private_ip }}:9092 \
       --topic raw_votes \
       --producer-property security.protocol=SASL_SSL \
       --producer-property sasl.mechanism=OAUTHBEARER \
       --producer-property ssl.truststore.location=/certs/ca.crt \
       --producer-property 'sasl.jaas.config=org.apache.kafka.common.security.oauthbearer.OAuthBearerLoginModule required;' \
       <<< 'test' 2>&1 | head -5"
# Resultado esperado: ERROR ... Authentication failed
```

### B2. Conexión con token válido funciona
```bash
# Obtener un token del auth_server (desde vm-core que tiene acceso de red)
ansible vm_core -i inventory.ini -b -a \
  "curl -sk \
    --cacert /opt/zero-trust/certs/ca.crt \
    -X POST https://{{ hostvars['vm-auth'].private_ip }}/token \
    -H 'content-type: application/json' \
    -d '{\"client_id\":\"vote-processor\",\"client_secret\":\"change-me\"}' \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[\"token_type\"], d[\"expires_in\"])'"
# Resultado esperado: Bearer 300
```

### B3. Token con client_id incorrecto es rechazado por auth_server
```bash
ansible vm_core -i inventory.ini -b -a \
  "curl -sk \
    --cacert /opt/zero-trust/certs/ca.crt \
    -X POST https://{{ hostvars['vm-auth'].private_ip }}/token \
    -H 'content-type: application/json' \
    -d '{\"client_id\":\"attacker\",\"client_secret\":\"guess\"}' "
# Resultado esperado: {"error":"invalid_client"}
```

---

## Bloque C — Verificación JWT en RabbitMQ (OAuth2 Backend)

### C1. Conexión anónima a RabbitMQ es rechazada
```bash
ansible vm_core -i inventory.ini -b -a \
  "docker run --rm --network host \
     -v /opt/zero-trust/certs:/certs:ro \
     python:3.12-alpine sh -c \
     'pip install pika -q && python3 -c \"
import pika, ssl
ctx = ssl.create_default_context(cafile=\\\"/certs/ca.crt\\\")
try:
    pika.BlockingConnection(pika.ConnectionParameters(
        host=\\\"{{ hostvars[\\\"vm-brokers\\\"].private_ip }}\\\",
        port=5672,
        credentials=pika.PlainCredentials(\\\"guest\\\", \\\"guest\\\"),
        ssl_options=pika.SSLOptions(ctx)
    ))
except Exception as e:
    print(\\\"REJECTED:\\\", e)
\"'"
# Resultado esperado: REJECTED: ACCESS_REFUSED
```

### C2. Verificar que RabbitMQ tiene oauth2 como único auth backend
```bash
ansible vm_brokers -i inventory.ini -b -a \
  "docker exec rabbitmq rabbitmqctl environment \
   | grep -E '(auth_backends|oauth2)'"
# Resultado esperado:
#   {auth_backends,[rabbit_auth_backend_oauth2]}
#   {oauth2,...}
```

---

## Bloque D — Flujo End-to-End

### D1. Registrar votantes y emitir un voto válido
```bash
# 1. Disparar voter-registration (ya fue ejecutado por Ansible como oneshot,
#    pero se puede re-ejecutar):
ansible vm_init -i inventory.ini -b -a \
  "systemctl restart voter-registration"

# 2. Esperar 3s a que Kafka procese
sleep 3

# 3. Emitir un voto — la API devuelve el user_id real del eligible_voter
#    (obtener uno de los logs del voter-registration-service)
USER_ID=$(ansible vm_init -i inventory.ini -b -a \
  "journalctl -u voter-registration --no-pager -n 5" \
  | grep user_id | head -1 | grep -oP '"user_id":"\K[^"]+')

curl -sk https://$VM_API/vote \
  -H "content-type: application/json" \
  -d "{\"user_id\":\"$USER_ID\",\"vote\":\"candidato-A\",\"region\":\"north\"}"
# Resultado esperado: {"ok":true}
```

### D2. Voto duplicado es rechazado a nivel de aplicación
```bash
# Segundo voto del mismo user_id
curl -sk https://$VM_API/vote \
  -H "content-type: application/json" \
  -d "{\"user_id\":\"$USER_ID\",\"vote\":\"candidato-B\",\"region\":\"north\"}"
# Resultado esperado: {"error":"user_not_eligible"}  (user-validation-service lo bloqueó)
```

### D3. El voto aparece en el dashboard global
```bash
# Esperar el debounce del fanout (2s) + publish interval (5s)
sleep 8

ansible vm_app -i inventory.ini -b -a \
  "curl -s http://localhost:3000/dashboard"
# Resultado esperado: {"totals":{"candidato-A":1},"snapshot_at":...}
```

### D4. El voto aparece en el dashboard regional
```bash
ansible vm_app -i inventory.ini -b -a \
  "curl -s http://localhost:3001/dashboard/regional/north"
# Resultado esperado: {"region":"north","totals":{"candidato-A":1},...}
```

### D5. El archivador persiste el registro
```bash
ansible vm_core -i inventory.ini -b -a \
  "ls -lh /var/lib/zt-archive/ && tail -1 /var/lib/zt-archive/processed_votes-$(date +%Y-%m-%d).ndjson"
# Resultado esperado: una línea JSON con el voto procesado
```

### D6. El bot-detector flaggea votación rápida
```bash
# Enviar 5 votos del mismo user_id rápidamente (la validación los bloqueará,
# pero podemos producir directo a raw_votes para probar el detector)
# Este test requiere un script de carga — ver D6-load-test.sh
```

---

## Bloque E — Estado de todos los servicios
```bash
# Todos los servicios deben estar active (running)
ansible all -i inventory.ini -b -a \
  "systemctl is-active auth-server kafka rabbitmq voting-api \
   voter-registration vote-processor bot-detector-service \
   regional-rollup-service analytics-archiver \
   global-dashboard-worker regional-dashboard-worker 2>/dev/null || true" \
  | grep -v "CHANGED\|SUCCESS\|rc=\|>>>"
```

---

## Resumen de la Matriz de Conectividad

| Origen    | Destino     | Puerto | nftables | JWT   |
|-----------|-------------|--------|----------|-------|
| vm-init   | vm-auth     | 443    | ✅ allow | ✅ TLS |
| vm-init   | vm-brokers  | 9092   | ✅ allow | ✅ SASL|
| vm-api    | vm-auth     | 443    | ✅ allow | ✅ TLS |
| vm-api    | vm-brokers  | 9092   | ✅ allow | ✅ SASL|
| vm-api    | vm-brokers  | 5672   | ✅ allow | ✅ OAuth2|
| vm-core   | vm-auth     | 443    | ✅ allow | ✅ TLS |
| vm-core   | vm-brokers  | 9092   | ✅ allow | ✅ SASL|
| vm-core   | vm-brokers  | 5672   | ✅ allow | ✅ OAuth2|
| vm-app    | vm-auth     | 443    | ✅ allow | ✅ TLS |
| vm-app    | vm-brokers  | 5672   | ✅ allow | ✅ OAuth2|
| Internet  | vm-api      | 443    | ✅ allow | N/A   |
| Internet  | vm-auth     | 443    | ❌ deny  | —     |
| Internet  | vm-brokers  | *      | ❌ deny  | —     |
| vm-app    | vm-core     | *      | ❌ deny  | —     |
| vm-app    | vm-init     | *      | ❌ deny  | —     |
