# Terraform generates an RSA key pair.
# The private key is saved to ./zt-voting.pem (chmod 400 applied automatically).
# The public key is registered in AWS as a Key Pair.

resource "tls_private_key" "ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "main" {
  key_name   = "${var.project}-key"
  public_key = tls_private_key.ssh.public_key_openssh

  tags = {
    Name    = "${var.project}-key"
    Project = var.project
  }
}

# Save the private key locally so Ansible can use it immediately.
resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.ssh.private_key_pem
  filename        = "${path.module}/zt-voting.pem"
  file_permission = "0400"
}
