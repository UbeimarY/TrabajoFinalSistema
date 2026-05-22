variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "zt-voting"
}

variable "vpc_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

variable "private_subnet_cidr" {
  type    = string
  default = "10.10.1.0/24"
}

variable "public_subnet_cidr" {
  type    = string
  default = "10.10.0.0/24"
}

variable "ami_id" {
  type    = string
  default = "ami-0e86e20dae9224db8"
}

variable "instance_types" {
  type = map(string)
  default = {
    auth    = "t3.micro"
    brokers = "t3.small"
    api     = "t3.micro"
    init    = "t3.micro"
    core    = "t3.small"
    app     = "t3.micro"
  }
}

variable "admin_cidr" {
  type = string
}

variable "root_volume_size_gb" {
  type    = number
  default = 20
}
