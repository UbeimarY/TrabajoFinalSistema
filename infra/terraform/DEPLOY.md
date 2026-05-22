# Guía de Despliegue — Zero Trust Voting Platform

Tiempo estimado total: **~25 minutos** (AWS tarda ~3 min en levantar las EC2
y el Ansible tarda ~15 min en instalar todo).

---

## 0. Prerrequisitos (una sola vez)

```bash
# 1. Instalar Terraform
#    https://developer.hashicorp.com/terraform/install
#    Ubuntu/Debian:
wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform -y

# Mac:
brew install terraform

# 2. Instalar AWS CLI v2
#    https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

# 3. Instalar Ansible
pip install ansible

# 4. Configurar credenciales AWS
aws configure
# Introduce: Access Key ID, Secret Access Key, región (us-east-1), output (json)
# Las credenciales se guardan en ~/.aws/credentials
```

---

## 1. Clonar y preparar

```bash
# Posiciónate en la raíz del repositorio
cd DistribuidoOperativos/

# Entra al directorio de Terraform
cd infra/terraform/
```

---

## 2. Obtener tu IP pública

```bash
# Necesitas tu IP para que el Security Group te permita SSH
MY_IP=$(curl -s ifconfig.me)
echo "Tu IP: $MY_IP"
```

---

## 3. Inicializar Terraform

```bash
terraform init
```

Descarga los providers de AWS, TLS y local. Solo se hace una vez.

---

## 4. Ver qué va a crear (plan)

```bash
terraform plan -var "admin_cidr=${MY_IP}/32"
```

Deberías ver **~25 resources to add** (VPC, subnets, IGW, NAT, EIP,
route tables, 6 SGs, 1 key pair, 6 EC2). Revisa que no haya errores.

---

## 5. Crear la infraestructura

```bash
terraform apply -var "admin_cidr=${MY_IP}/32"
```

Escribe `yes` cuando lo pida. Tarda ~3-4 minutos.

Al terminar verás algo como:

```
Outputs:
vm_api_public_ip     = "54.x.x.x"
vm_auth_private_ip   = "10.10.1.10"
vm_brokers_private_ip = "10.10.1.11"
...
ssh_key_path         = "./zt-voting.pem"
```

Terraform también habrá generado automáticamente el archivo `inventory.ini`.

---

## 6. Esperar a que las VMs estén listas

```bash
# Las EC2 necesitan ~60-90 segundos para terminar cloud-init (instala Python)
echo "Esperando 90 segundos..."
sleep 90

# Verificar conectividad SSH a todas las VMs
ansible all -i inventory.ini -m ping
```

Deberías ver `pong` para las 6 VMs. Si alguna falla, espera 30 segundos más
y repite.

> **Nota:** Las VMs privadas (vm-auth, vm-brokers, vm-init, vm-core, vm-app)
> no tienen IP pública. Ansible las alcanza a través de vm-api usando un
> SSH ProxyJump. El `inventory.ini` generado ya incluye la configuración
> necesaria. Si no funciona, añade esta sección al `inventory.ini`:
>
> ```ini
> [all:vars]
> ansible_ssh_common_args=-o ProxyJump=ubuntu@<IP_PUBLICA_VM_API> -o StrictHostKeyChecking=no
> ```

---

## 7. Actualizar el repo_url en inventory.ini

```bash
# Edita inventory.ini y reemplaza repo_url con tu repositorio real:
nano inventory.ini
# Busca la línea:  repo_url=https://github.com/TU_USUARIO/DistribuidoOperativos.git
# Cámbiala por la URL real de tu repo
```

---

## 8. Ejecutar Ansible — Fase 1 (infraestructura base)

```bash
cd ../ansible/

# Instala Docker, nftables, genera certificados, despliega auth-server,
# brokers, voting-api, voter-registration, user-validation
ansible-playbook -i ../../terraform/inventory.ini site.yml
```

Tarda ~12-15 minutos. Verás el progreso tarea por tarea.

---

## 9. Ejecutar Ansible — Fase 2 (servicios restantes)

```bash
# Despliega vote-processor, bot-detector, regional-rollup, analytics-archiver,
# global-dashboard-worker, regional-dashboard-worker
ansible-playbook -i ../../terraform/inventory.ini site_extension.yml
```

Tarda ~5-8 minutos.

---

## 10. Verificar que todo funciona

```bash
# Ver IP pública de la API
terraform -chdir=../terraform output vm_api_public_ip

# Test rápido de salud
VM_API=$(terraform -chdir=../terraform output -raw vm_api_public_ip)
curl -sk https://$VM_API/health
# Esperado: {"ok":true}

# Guía completa de verificación Zero Trust:
cat VERIFY.md
```

---

## Teardown (destruir todo al terminar)

```bash
cd infra/terraform/
terraform destroy -var "admin_cidr=${MY_IP}/32"
# Escribe 'yes'
# Elimina TODAS las VMs, VPC, NAT Gateway, EIP, etc.
# Costo $0 después de esto.
```

---

## Costo estimado mientras las VMs están corriendo

| Recurso | Cantidad | Precio/hora |
|---|---|---|
| t3.micro (vm-init) | 1 | ~$0.01 |
| t3.small (vm-auth, vm-api, vm-core, vm-app) | 4 | ~$0.08 |
| t3.medium (vm-brokers) | 1 | ~$0.05 |
| NAT Gateway | 1 | ~$0.045 |
| EIP (mientras asignada) | 1 | ~$0.005 |
| **Total** | | **~$0.19/hora** |

Para una demo de 4 horas: ~$0.76 USD. Usa `terraform destroy` al terminar.

---

## Troubleshooting

**"Permission denied (publickey)"** al hacer ping con Ansible:
```bash
# Verificar permisos de la llave
chmod 400 infra/terraform/zt-voting.pem
# Verificar que la llave correcta está en inventory.ini
grep private_key infra/terraform/inventory.ini
```

**Las VMs privadas no responden:**
```bash
# Necesitas saltar por vm-api (que sí tiene IP pública)
# Añade al inventory.ini bajo [all:vars]:
# ansible_ssh_common_args=-o StrictHostKeyChecking=no -o ProxyJump=ubuntu@<IP_VM_API>
```

**"apt-get lock" durante el Ansible play:**
```bash
# cloud-init puede seguir corriendo; espera 2 minutos y reintenta
ansible-playbook -i inventory.ini site.yml
# Ansible es idempotente — seguro de re-ejecutar
```

**Kafka no arranca:**
```bash
ansible vm_brokers -i inventory.ini -b -a "journalctl -u kafka -n 50 --no-pager"
# El error más común es que el JWKS endpoint del auth-server no responde;
# asegúrate de que auth-server esté activo primero:
ansible vm_auth -i inventory.ini -b -a "systemctl status auth-server"
```
