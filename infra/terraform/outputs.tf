# ─────────────────────────────────────────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────────────────────────────────────────

output "vm_api_public_ip" {
  description = "Public IP of vm-api (voting endpoint — share with testers)."
  value       = aws_instance.api.public_ip
}

output "vm_auth_private_ip" {
  value = aws_instance.auth.private_ip
}

output "vm_brokers_private_ip" {
  value = aws_instance.brokers.private_ip
}

output "vm_api_private_ip" {
  value = aws_instance.api.private_ip
}

output "vm_init_private_ip" {
  value = aws_instance.init.private_ip
}

output "vm_core_private_ip" {
  value = aws_instance.core.private_ip
}

output "vm_app_private_ip" {
  value = aws_instance.app.private_ip
}

output "ssh_key_path" {
  description = "Path to the generated private SSH key."
  value       = local_sensitive_file.private_key.filename
}

# ── Auto-generated Ansible inventory ─────────────────────────────────────────
# After `terraform apply`, run:
#   cat inventory.ini          ← review it
#   ansible-playbook -i inventory.ini site.yml
#   ansible-playbook -i inventory.ini site_extension.yml

resource "local_file" "ansible_inventory" {
  filename = "${path.module}/inventory.ini"
  content  = <<-INI
    [all:vars]
    ansible_user=ubuntu
    ansible_ssh_private_key_file=${abspath(local_sensitive_file.private_key.filename)}
    ansible_ssh_common_args=-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
    admin_cidr=${var.admin_cidr}
    repo_url=https://github.com/TU_USUARIO/DistribuidoOperativos.git
    repo_ref=main

    [vm_auth]
    vm-auth ansible_host=${aws_instance.auth.private_ip} private_ip=${aws_instance.auth.private_ip}

    [vm_brokers]
    vm-brokers ansible_host=${aws_instance.brokers.private_ip} private_ip=${aws_instance.brokers.private_ip}

    [vm_api]
    vm-api ansible_host=${aws_instance.api.public_ip} private_ip=${aws_instance.api.private_ip}

    [vm_init]
    vm-init ansible_host=${aws_instance.init.private_ip} private_ip=${aws_instance.init.private_ip}

    [vm_core]
    vm-core ansible_host=${aws_instance.core.private_ip} private_ip=${aws_instance.core.private_ip}

    [vm_app]
    vm-app ansible_host=${aws_instance.app.private_ip} private_ip=${aws_instance.app.private_ip}
  INI
}
