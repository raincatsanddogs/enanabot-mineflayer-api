# about the project

（文档待更新！）此项目以JavaScript编写，基于mineflayer，可以做到：读取账号信息，进行登录，发送服务器消息至console以供解析（目前正在与[nonebot部分](https://github.com/raincatsanddogs/enanabot)拆分以更好集成，拆分后会使用WebSocket进行通信）

## configs/

解析配置项

## login/

用于服务器登录

## handler/

用于各类消息解析

## 指令系统 (Command System)

JS 端内置了一套类 nonebot 风格的指令拦截与分发系统，专为需要极速响应或强依赖内部状态（例如 TPA 请求）的功能设计，可以减少不必要的 IPC 通信。

* 详细说明、API Reference 和示例代码请参考：[COMMAND_SYSTEM](./COMMAND_SYSTEM.md)

## 食用方法

node index.js

参数：-p 1 以第一个档案启动
-s 1 以第一个服务器启动
在不加参数时默认以第一个档案第一个服务器启动

## console 消息输出参考格式

## console 消息输入参考格式

## todo

- v1
- [x] 多账号、多皮肤站登录
- [x] 多服务器登录
- [x] 消息处理
- [x] 连接nonebot，并配置权限组，指令
- v2
- [x] 私聊消息处理
- [x] 容器处理
- v3
- [] 瞄准
- [] 进食
- [] 攻击

